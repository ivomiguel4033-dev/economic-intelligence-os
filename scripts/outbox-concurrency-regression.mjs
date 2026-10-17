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
         attempts=o.attempts + 1, claim_token=o.claim_token + 1,
         last_error=NULL, dead_lettered_at=NULL, updated_at=NOW()
     FROM candidates c
     WHERE o.id=c.id
     RETURNING o.id, o.organization_id, o.dedupe_key, o.attempts, o.claim_token::text AS claim_token`,
    [workerId, limit],
  );
  return result.rows;
}

async function enqueueIdempotent({ organizationId, executionRunId = null, eventType, dedupeKey, payload }) {
  return pool.query(
    `INSERT INTO execution_outbox (organization_id, execution_run_id, event_type, dedupe_key, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (organization_id, dedupe_key) DO UPDATE
       SET dedupe_key=EXCLUDED.dedupe_key
       WHERE execution_outbox.execution_run_id IS NOT DISTINCT FROM EXCLUDED.execution_run_id
         AND execution_outbox.event_type=EXCLUDED.event_type
         AND execution_outbox.payload=EXCLUDED.payload
     RETURNING id`,
    [organizationId, executionRunId, eventType, dedupeKey, JSON.stringify(payload)],
  );
}

async function transitionWithOutbox({ organizationId, runId, expectedState, state, eventType, dedupeKey, payload }) {
  return pool.query(
    `WITH transitioned AS (
       UPDATE execution_runs
       SET state=$4, updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND state=$3
       RETURNING id, organization_id
     )
     INSERT INTO execution_outbox (organization_id, execution_run_id, event_type, dedupe_key, payload)
     SELECT organization_id, id, $5, $6, $7::jsonb
     FROM transitioned
     RETURNING id`,
    [runId, organizationId, expectedState, state, eventType, dedupeKey, JSON.stringify(payload)],
  );
}

try {
  const orgA = await pool.query(`INSERT INTO organizations (name, slug) VALUES ('outbox-a', 'outbox-a') RETURNING id`);
  const orgB = await pool.query(`INSERT INTO organizations (name, slug) VALUES ('outbox-b', 'outbox-b') RETURNING id`);
  const organizationA = orgA.rows[0].id;
  const organizationB = orgB.rows[0].id;

  const idempotencyRunA = await pool.query(
    `INSERT INTO execution_runs (organization_id, action_id, action_type, idempotency_key)
     VALUES ($1, 'idempotency-contract-a', 'test.idempotency', 'idempotency-contract-run-a') RETURNING id`,
    [organizationA],
  );
  const idempotencyRunB = await pool.query(
    `INSERT INTO execution_runs (organization_id, action_id, action_type, idempotency_key)
     VALUES ($1, 'idempotency-contract-b', 'test.idempotency', 'idempotency-contract-run-b') RETURNING id`,
    [organizationA],
  );
  const idempotencyKey = 'idempotency-contract';
  const canonicalPayload = { version: 1, value: 'canonical' };
  const canonical = await enqueueIdempotent({
    organizationId: organizationA,
    executionRunId: idempotencyRunA.rows[0].id,
    eventType: 'test.idempotency',
    dedupeKey: idempotencyKey,
    payload: canonicalPayload,
  });
  assert.equal(canonical.rowCount, 1);

  const replay = await enqueueIdempotent({
    organizationId: organizationA,
    executionRunId: idempotencyRunA.rows[0].id,
    eventType: 'test.idempotency',
    dedupeKey: idempotencyKey,
    payload: canonicalPayload,
  });
  assert.equal(replay.rowCount, 1, 'an exact idempotent replay must succeed');
  assert.equal(replay.rows[0].id, canonical.rows[0].id, 'an exact replay must resolve to the original outbox row');

  const conflictingPayload = await enqueueIdempotent({
    organizationId: organizationA,
    executionRunId: idempotencyRunA.rows[0].id,
    eventType: 'test.idempotency',
    dedupeKey: idempotencyKey,
    payload: { version: 2, value: 'conflict' },
  });
  assert.equal(conflictingPayload.rowCount, 0, 'same-tenant dedupe keys must reject different payloads');

  const conflictingEvent = await enqueueIdempotent({
    organizationId: organizationA,
    executionRunId: idempotencyRunA.rows[0].id,
    eventType: 'test.idempotency.changed',
    dedupeKey: idempotencyKey,
    payload: canonicalPayload,
  });
  assert.equal(conflictingEvent.rowCount, 0, 'same-tenant dedupe keys must reject different event types');

  const conflictingRun = await enqueueIdempotent({
    organizationId: organizationA,
    executionRunId: idempotencyRunB.rows[0].id,
    eventType: 'test.idempotency',
    dedupeKey: idempotencyKey,
    payload: canonicalPayload,
  });
  assert.equal(conflictingRun.rowCount, 0, 'same-tenant dedupe keys must reject different execution runs');

  const secondTenantSameKey = await enqueueIdempotent({
    organizationId: organizationB,
    eventType: 'test.idempotency',
    dedupeKey: idempotencyKey,
    payload: canonicalPayload,
  });
  assert.equal(secondTenantSameKey.rowCount, 1, 'dedupe keys must remain isolated by tenant');

  const idempotencyRows = await pool.query(
    `SELECT organization_id, event_type, payload
     FROM execution_outbox
     WHERE dedupe_key=$1
     ORDER BY organization_id`,
    [idempotencyKey],
  );
  assert.equal(idempotencyRows.rowCount, 2, 'the same dedupe key may exist once per tenant');
  const tenantACanonical = idempotencyRows.rows.find((row) => row.organization_id === organizationA);
  assert.deepEqual(tenantACanonical.payload, canonicalPayload, 'conflicting replays must not mutate the canonical event');
  assert.equal(tenantACanonical.event_type, 'test.idempotency');

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
  assert.ok([...workerOne, ...workerTwo].every((row) => row.claim_token === '1'));

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
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3 AND claim_token=$4::bigint
     RETURNING id`,
    [owned.id, organizationA, wrongOwner, owned.claim_token],
  );
  assert.equal(rejectedAck.rowCount, 0, 'another worker must not acknowledge the claim');

  const acceptedAck = await pool.query(
    `UPDATE execution_outbox
     SET status='delivered', delivered_at=NOW(), claimed_at=NULL, claimed_by=NULL
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3 AND claim_token=$4::bigint
     RETURNING id`,
    [owned.id, organizationA, ownerId, owned.claim_token],
  );
  assert.equal(acceptedAck.rowCount, 1);

  const stale = await pool.query(
    `INSERT INTO execution_outbox
       (organization_id, event_type, dedupe_key, payload, status, attempts, claimed_at, claimed_by, claim_token)
     VALUES ($1, 'test.stale', 'stale-key', '{}'::jsonb, 'processing', 1, NOW() - INTERVAL '10 minutes', 'recovery-worker', 1)
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
  assert.equal(recoveredClaim.claim_token, '2', 'every claim must advance the fencing token');

  const staleSameWorkerAck = await pool.query(
    `UPDATE execution_outbox
     SET status='delivered', delivered_at=NOW(), claimed_at=NULL, claimed_by=NULL
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3 AND claim_token=$4::bigint
     RETURNING id`,
    [stale.rows[0].id, organizationA, 'recovery-worker', '1'],
  );
  assert.equal(staleSameWorkerAck.rowCount, 0, 'stale claim token must be rejected even when workerId is reused');

  const currentSameWorkerAck = await pool.query(
    `UPDATE execution_outbox
     SET status='delivered', delivered_at=NOW(), claimed_at=NULL, claimed_by=NULL
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3 AND claim_token=$4::bigint
     RETURNING id`,
    [stale.rows[0].id, organizationA, 'recovery-worker', recoveredClaim.claim_token],
  );
  assert.equal(currentSameWorkerAck.rowCount, 1, 'current fencing token must acknowledge successfully');

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

  const atomicRun = await pool.query(
    `INSERT INTO execution_runs (organization_id, action_id, action_type, idempotency_key)
     VALUES ($1, 'atomic-action', 'test.atomic', 'atomic-run') RETURNING id`,
    [organizationA],
  );
  const atomicRunId = atomicRun.rows[0].id;

  const atomicSuccess = await transitionWithOutbox({
    organizationId: organizationA,
    runId: atomicRunId,
    expectedState: 'pending',
    state: 'running',
    eventType: 'execution.running',
    dedupeKey: 'atomic-success',
    payload: { runId: atomicRunId },
  });
  assert.equal(atomicSuccess.rowCount, 1, 'valid transition must atomically create one outbox event');

  const atomicState = await pool.query(`SELECT state FROM execution_runs WHERE id=$1`, [atomicRunId]);
  assert.equal(atomicState.rows[0].state, 'running');

  await pool.query(
    `INSERT INTO execution_outbox (organization_id, event_type, dedupe_key, payload)
     VALUES ($1, 'test.conflict', 'atomic-conflict', '{}'::jsonb)`,
    [organizationA],
  );

  await assert.rejects(
    transitionWithOutbox({
      organizationId: organizationA,
      runId: atomicRunId,
      expectedState: 'running',
      state: 'succeeded',
      eventType: 'execution.succeeded',
      dedupeKey: 'atomic-conflict',
      payload: { runId: atomicRunId },
    }),
    /duplicate key|unique constraint/i,
    'outbox insertion failure must reject the whole statement',
  );

  const rolledBackState = await pool.query(`SELECT state FROM execution_runs WHERE id=$1`, [atomicRunId]);
  assert.equal(rolledBackState.rows[0].state, 'running', 'failed outbox insert must roll back execution state transition');

  const [raceOne, raceTwo] = await Promise.all([
    transitionWithOutbox({ organizationId: organizationA, runId: atomicRunId, expectedState: 'running', state: 'succeeded', eventType: 'execution.succeeded', dedupeKey: 'atomic-race-1', payload: {} }),
    transitionWithOutbox({ organizationId: organizationA, runId: atomicRunId, expectedState: 'running', state: 'failed', eventType: 'execution.failed', dedupeKey: 'atomic-race-2', payload: {} }),
  ]);
  assert.equal(raceOne.rowCount + raceTwo.rowCount, 1, 'CAS transition must allow only one concurrent terminal transition');

  const raceEvents = await pool.query(
    `SELECT count(*)::int AS count FROM execution_outbox
     WHERE organization_id=$1 AND dedupe_key IN ('atomic-race-1','atomic-race-2')`,
    [organizationA],
  );
  assert.equal(raceEvents.rows[0].count, 1, 'only the winning concurrent transition may emit an outbox event');

  console.log('outbox concurrency regression checks passed');
} finally {
  await pool.query(`DELETE FROM organizations WHERE slug IN ('outbox-a','outbox-b')`).catch(() => {});
  await pool.end();
}
