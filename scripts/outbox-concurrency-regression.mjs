import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recoverStale(maxProcessingSeconds = 300, retryAfterSeconds = 1, maxAttempts = 5) {
  const result = await pool.query(
    `UPDATE execution_outbox
     SET status=CASE WHEN attempts >= $3 THEN 'dead_lettered' ELSE 'failed' END,
         available_at=CASE WHEN attempts >= $3 THEN available_at ELSE NOW() + ($2 * INTERVAL '1 second') END,
         claimed_at=NULL, claimed_by=NULL,
         last_error='stale processing claim reclaimed',
         dead_lettered_at=CASE WHEN attempts >= $3 THEN NOW() ELSE NULL END,
         updated_at=NOW()
     WHERE status='processing'
       AND claimed_at IS NOT NULL
       AND claimed_at <= NOW() - ($1 * INTERVAL '1 second')
     RETURNING id, status`,
    [maxProcessingSeconds, retryAfterSeconds, maxAttempts],
  );
  return result.rows;
}

async function claim(workerId, limit = 10) {
  const result = await pool.query(
    `WITH candidates AS (
       SELECT id
       FROM execution_outbox
       WHERE status IN ('pending','failed') AND available_at <= NOW()
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE execution_outbox o
     SET status='processing', claimed_at=NOW(), claimed_by=$1,
         attempts=o.attempts + 1, last_error=NULL, dead_lettered_at=NULL, updated_at=NOW()
     FROM candidates c
     WHERE o.id=c.id
     RETURNING o.id, o.organization_id, o.dedupe_key, o.attempts`,
    [workerId, limit],
  );
  return result.rows;
}

try {
  const orgA = await pool.query(`INSERT INTO organizations (name, slug) VALUES ('outbox-a', 'outbox-a') RETURNING id`);
  const orgB = await pool.query(`INSERT INTO organizations (name, slug) VALUES ('outbox-b', 'outbox-b') RETURNING id`);
  const organizationA = orgA.rows[0].id;
  const organizationB = orgB.rows[0].id;

  await pool.query(
    `INSERT INTO execution_outbox (organization_id, event_type, dedupe_key, payload)
     SELECT $1, 'test.event', 'key-' || n::text, jsonb_build_object('n', n)
     FROM generate_series(1, 20) AS n`,
    [organizationA],
  );

  await pool.query(
    `INSERT INTO execution_outbox (organization_id, event_type, dedupe_key, payload)
     VALUES ($1, 'test.event', 'key-1', '{}'::jsonb)`,
    [organizationB],
  );

  const [workerOne, workerTwo] = await Promise.all([
    claim('worker-one', 10),
    claim('worker-two', 10),
  ]);

  assert.equal(workerOne.length + workerTwo.length, 20);
  const ids = [...workerOne, ...workerTwo].map((row) => row.id);
  assert.equal(new Set(ids).size, 20, 'SKIP LOCKED must prevent duplicate claims');
  assert.ok([...workerOne, ...workerTwo].every((row) => row.attempts === 1));

  const tenantB = await pool.query(
    `SELECT status FROM execution_outbox WHERE organization_id=$1 AND dedupe_key='key-1'`,
    [organizationB],
  );
  assert.equal(tenantB.rows[0].status, 'pending');

  const owned = workerOne[0] ?? workerTwo[0];
  const ownerId = workerOne.some((row) => row.id === owned.id) ? 'worker-one' : 'worker-two';
  const wrongOwner = ownerId === 'worker-one' ? 'worker-two' : 'worker-one';

  const rejectedAck = await pool.query(
    `UPDATE execution_outbox
     SET status='delivered', delivered_at=NOW(), claimed_at=NULL, claimed_by=NULL
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3
     RETURNING id`,
    [owned.id, organizationA, wrongOwner],
  );
  assert.equal(rejectedAck.rowCount, 0, 'another worker must not acknowledge the claim');

  const acceptedAck = await pool.query(
    `UPDATE execution_outbox
     SET status='delivered', delivered_at=NOW(), claimed_at=NULL, claimed_by=NULL
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3
     RETURNING id`,
    [owned.id, organizationA, ownerId],
  );
  assert.equal(acceptedAck.rowCount, 1);

  const stale = await pool.query(
    `INSERT INTO execution_outbox
       (organization_id, event_type, dedupe_key, payload, status, attempts, claimed_at, claimed_by)
     VALUES ($1, 'test.stale', 'stale-key', '{}'::jsonb, 'processing', 1, NOW() - INTERVAL '10 minutes', 'dead-worker')
     RETURNING id`,
    [organizationA],
  );

  const recovered = await recoverStale(300, 1, 5);
  assert.ok(recovered.some((row) => row.id === stale.rows[0].id && row.status === 'failed'), 'stale processing claim must be recovered');

  await pool.query(`UPDATE execution_outbox SET available_at=NOW() WHERE id=$1`, [stale.rows[0].id]);
  const reclaimed = await claim('recovery-worker', 10);
  const recoveredClaim = reclaimed.find((row) => row.id === stale.rows[0].id);
  assert.ok(recoveredClaim, 'recovered message must become claimable again');
  assert.equal(recoveredClaim.attempts, 2, 'recovered delivery must preserve attempt history');

  const poison = await pool.query(
    `INSERT INTO execution_outbox
       (organization_id, event_type, dedupe_key, payload, status, attempts, claimed_at, claimed_by)
     VALUES ($1, 'test.poison', 'poison-key', '{}'::jsonb, 'processing', 5, NOW() - INTERVAL '10 minutes', 'dead-worker')
     RETURNING id`,
    [organizationA],
  );

  const deadLettered = await recoverStale(300, 1, 5);
  assert.ok(deadLettered.some((row) => row.id === poison.rows[0].id && row.status === 'dead_lettered'), 'exhausted stale claim must be dead-lettered');

  const poisonRow = await pool.query(
    `SELECT status, dead_lettered_at IS NOT NULL AS stamped FROM execution_outbox WHERE id=$1`,
    [poison.rows[0].id],
  );
  assert.equal(poisonRow.rows[0].status, 'dead_lettered');
  assert.equal(poisonRow.rows[0].stamped, true);

  const afterDeadLetter = await claim('late-worker', 100);
  assert.ok(!afterDeadLetter.some((row) => row.id === poison.rows[0].id), 'dead-lettered message must never be reclaimed');

  console.log('outbox concurrency regression checks passed');
} finally {
  await pool.query(`DELETE FROM organizations WHERE slug IN ('outbox-a','outbox-b')`).catch(() => {});
  await pool.end();
}
