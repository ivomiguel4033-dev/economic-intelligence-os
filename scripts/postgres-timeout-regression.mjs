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
});

try {
  const settings = await pool.query(`
    select
      current_setting('statement_timeout') as statement_timeout,
      current_setting('idle_in_transaction_session_timeout') as idle_in_transaction_session_timeout
  `);
  assert.equal(settings.rows[0].statement_timeout, "30s");
  assert.equal(settings.rows[0].idle_in_transaction_session_timeout, "30s");

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

  const healthy = await pool.query("select 1 as ok");
  assert.equal(healthy.rows[0].ok, 1, "pool must remain usable after a timed-out statement");
  console.log("PostgreSQL timeout regression checks passed");
} finally {
  await pool.end();
}
