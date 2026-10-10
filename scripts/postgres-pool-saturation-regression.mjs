import assert from "node:assert/strict";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, "DATABASE_URL is required");

const { Pool } = pg;
const pool = new Pool({
  connectionString,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 250,
  statement_timeout: 30_000,
  query_timeout: 35_000,
  idle_in_transaction_session_timeout: 30_000,
});

const clients = [];
try {
  clients.push(await pool.connect());
  clients.push(await pool.connect());
  assert.equal(pool.totalCount, 2, "test must fully saturate the configured pool");
  assert.equal(pool.idleCount, 0, "saturated pool must have no idle connections");

  const started = Date.now();
  await assert.rejects(
    pool.connect(),
    (error) => /timeout exceeded when trying to connect/i.test(error?.message ?? ""),
    "pool acquisition must fail closed when capacity remains exhausted",
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 150, "pool acquisition must exercise the configured wait timeout");
  assert.ok(elapsed < 1_500, "pool acquisition must remain bounded under saturation");

  clients.pop().release();
  const recovered = await pool.connect();
  try {
    const healthy = await recovered.query("select 1 as ok");
    assert.equal(healthy.rows[0].ok, 1, "pool must recover immediately after capacity is released");
  } finally {
    recovered.release();
  }

  console.log("PostgreSQL pool saturation regression checks passed");
} finally {
  for (const client of clients) client.release();
  await pool.end();
}
