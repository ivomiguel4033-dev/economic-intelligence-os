import assert from "node:assert/strict";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, "DATABASE_URL is required");

const { Pool } = pg;
const pool = new Pool({
  connectionString,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  query_timeout: 35_000,
  idle_in_transaction_session_timeout: 30_000,
  lock_timeout: 5_000,
});

try {
  const settings = await pool.query(`
    select
      current_setting('statement_timeout') as statement_timeout,
      current_setting('idle_in_transaction_session_timeout') as idle_in_transaction_session_timeout,
      current_setting('lock_timeout') as lock_timeout
  `);
  assert.equal(settings.rows[0].statement_timeout, "30s");
  assert.equal(settings.rows[0].idle_in_transaction_session_timeout, "30s");
  assert.equal(settings.rows[0].lock_timeout, "5s");

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '100ms'");
    const started = Date.now();
    await assert.rejects(
      client.query("select pg_sleep(2)"),
      (error) => error?.code === "57014",
      "PostgreSQL must cancel a statement that exceeds statement_timeout",
    );
    assert.ok(Date.now() - started < 1_500, "statement timeout must bound blocked work promptly");
    await client.query("rollback");
  } finally {
    client.release();
  }

  const lockHolder = await pool.connect();
  const lockWaiter = await pool.connect();
  try {
    await lockHolder.query("begin");
    await lockHolder.query("select pg_advisory_xact_lock(77112233)");
    await lockWaiter.query("begin");
    await lockWaiter.query("set local lock_timeout = '100ms'");
    const started = Date.now();
    await assert.rejects(
      lockWaiter.query("select pg_advisory_xact_lock(77112233)"),
      (error) => error?.code === "55P03",
      "PostgreSQL must cancel lock acquisition that exceeds lock_timeout",
    );
    assert.ok(Date.now() - started < 1_500, "lock timeout must bound contention promptly");
    await lockWaiter.query("rollback");
    await lockHolder.query("rollback");
  } finally {
    lockWaiter.release();
    lockHolder.release();
  }

  const healthy = await pool.query("select 1 as ok");
  assert.equal(healthy.rows[0].ok, 1, "pool must remain usable after timeout cancellation");
  console.log("PostgreSQL timeout regression checks passed");
} finally {
  await pool.end();
}
