import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
         attempts=o.attempts + 1, last_error=NULL, updated_at=NOW()
     FROM candidates c
     WHERE o.id=c.id
     RETURNING o.id, o.organization_id, o.dedupe_key, o.attempts`,
    [workerId, limit],
  );
  return result.rows;
}

try {
  const orgA = await pool.query(`INSERT INTO organizations (name) VALUES ('outbox-a') RETURNING id`);
  const orgB = await pool.query(`INSERT INTO organizations (name) VALUES ('outbox-b') RETURNING id`);
  const organizationA = orgA.rows[0].id;
  const organizationB = orgB.rows[0].id;

  await pool.query(
    `INSERT INTO execution_outbox (organization_id, event_type, dedupe_key, payload)
     SELECT $1, 'test.event', 'key-' || n::text, jsonb_build_object('n', n)
     FROM generate_series(1, 20) AS n`,
    [organizationA],
  );

  // Same dedupe key is valid in another tenant.
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

  console.log('outbox concurrency regression checks passed');
} finally {
  await pool.query(`DELETE FROM organizations WHERE name IN ('outbox-a','outbox-b')`).catch(() => {});
  await pool.end();
}
