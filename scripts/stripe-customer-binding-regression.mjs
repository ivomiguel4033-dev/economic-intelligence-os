import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 2 });

async function syncSubscription(snapshot) {
  const result = await pool.query(
    `INSERT INTO billing_customers (
      organization_id, stripe_customer_id, stripe_subscription_id, plan_code,
      subscription_state, current_period_end, cancel_at_period_end,
      last_stripe_event_created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
    ON CONFLICT (organization_id) DO UPDATE SET
      stripe_customer_id=EXCLUDED.stripe_customer_id,
      stripe_subscription_id=EXCLUDED.stripe_subscription_id,
      plan_code=EXCLUDED.plan_code,
      subscription_state=EXCLUDED.subscription_state,
      current_period_end=EXCLUDED.current_period_end,
      cancel_at_period_end=EXCLUDED.cancel_at_period_end,
      last_stripe_event_created_at=EXCLUDED.last_stripe_event_created_at,
      updated_at=now()
    WHERE (billing_customers.stripe_customer_id IS NULL
       OR billing_customers.stripe_customer_id=EXCLUDED.stripe_customer_id)
      AND (billing_customers.last_stripe_event_created_at IS NULL
       OR billing_customers.last_stripe_event_created_at <= EXCLUDED.last_stripe_event_created_at)
    RETURNING organization_id`,
    [
      snapshot.organizationId,
      snapshot.stripeCustomerId,
      snapshot.stripeSubscriptionId,
      snapshot.planCode,
      snapshot.state,
      snapshot.currentPeriodEnd ?? null,
      snapshot.cancelAtPeriodEnd,
      snapshot.stripeEventCreatedAt,
    ],
  );

  if (result.rowCount) return "applied";

  const existing = await pool.query(
    `SELECT stripe_customer_id, last_stripe_event_created_at
     FROM billing_customers
     WHERE organization_id=$1`,
    [snapshot.organizationId],
  );
  const row = existing.rows[0];
  if (row && row.stripe_customer_id === snapshot.stripeCustomerId) {
    const lastCreatedAt = row.last_stripe_event_created_at === null ? null : Number(row.last_stripe_event_created_at);
    if (lastCreatedAt !== null && lastCreatedAt > snapshot.stripeEventCreatedAt) return "stale";
  }

  throw new Error(`Stripe customer mismatch for organization ${snapshot.organizationId}`);
}

let organizationA;
let organizationB;

try {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const organizations = await pool.query(
    `INSERT INTO organizations (name, slug)
     VALUES ($1,$2),($3,$4)
     RETURNING id, slug`,
    [
      "Stripe binding regression A",
      `stripe-binding-a-${suffix}`,
      "Stripe binding regression B",
      `stripe-binding-b-${suffix}`,
    ],
  );
  organizationA = organizations.rows[0].id;
  organizationB = organizations.rows[1].id;

  const initial = {
    organizationId: organizationA,
    stripeCustomerId: `cus_regression_a_${suffix}`,
    stripeSubscriptionId: `sub_regression_a_${suffix}`,
    planCode: "starter",
    state: "trialing",
    cancelAtPeriodEnd: false,
    stripeEventCreatedAt: 100,
  };

  assert.equal(await syncSubscription(initial), "applied");
  assert.equal(await syncSubscription({
    ...initial,
    stripeSubscriptionId: `sub_regression_a_updated_${suffix}`,
    planCode: "growth",
    state: "active",
    stripeEventCreatedAt: 200,
  }), "applied");

  assert.equal(await syncSubscription({
    ...initial,
    stripeSubscriptionId: `sub_regression_a_stale_${suffix}`,
    planCode: "enterprise",
    state: "past_due",
    stripeEventCreatedAt: 150,
  }), "stale");

  await assert.rejects(
    () => syncSubscription({
      ...initial,
      stripeCustomerId: `cus_regression_rebind_${suffix}`,
      stripeSubscriptionId: `sub_regression_rebind_${suffix}`,
      planCode: "enterprise",
      state: "past_due",
      stripeEventCreatedAt: 300,
    }),
    /Stripe customer mismatch/,
  );

  const persisted = await pool.query(
    `SELECT stripe_customer_id, stripe_subscription_id, plan_code, subscription_state, last_stripe_event_created_at
     FROM billing_customers
     WHERE organization_id=$1`,
    [organizationA],
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].stripe_customer_id, initial.stripeCustomerId);
  assert.equal(persisted.rows[0].stripe_subscription_id, `sub_regression_a_updated_${suffix}`);
  assert.equal(persisted.rows[0].plan_code, "growth");
  assert.equal(persisted.rows[0].subscription_state, "active");
  assert.equal(Number(persisted.rows[0].last_stripe_event_created_at), 200);

  const [olderConcurrentResult, newerConcurrentResult] = await Promise.all([
    syncSubscription({
      ...initial,
      stripeSubscriptionId: `sub_regression_concurrent_old_${suffix}`,
      planCode: "growth",
      state: "past_due",
      stripeEventCreatedAt: 250,
    }),
    syncSubscription({
      ...initial,
      stripeSubscriptionId: `sub_regression_concurrent_new_${suffix}`,
      planCode: "enterprise",
      state: "active",
      stripeEventCreatedAt: 400,
    }),
  ]);
  assert.ok(["applied", "stale"].includes(olderConcurrentResult));
  assert.equal(newerConcurrentResult, "applied");

  const afterConcurrent = await pool.query(
    `SELECT stripe_subscription_id, plan_code, subscription_state, last_stripe_event_created_at
     FROM billing_customers
     WHERE organization_id=$1`,
    [organizationA],
  );
  assert.equal(afterConcurrent.rowCount, 1);
  assert.equal(afterConcurrent.rows[0].stripe_subscription_id, `sub_regression_concurrent_new_${suffix}`);
  assert.equal(afterConcurrent.rows[0].plan_code, "enterprise");
  assert.equal(afterConcurrent.rows[0].subscription_state, "active");
  assert.equal(Number(afterConcurrent.rows[0].last_stripe_event_created_at), 400);

  await assert.rejects(
    () => syncSubscription({
      ...initial,
      organizationId: organizationB,
      stripeSubscriptionId: `sub_regression_b_${suffix}`,
      stripeEventCreatedAt: 500,
    }),
    (error) => error?.code === "23505",
  );

  const tenantB = await pool.query(
    `SELECT stripe_customer_id FROM billing_customers WHERE organization_id=$1`,
    [organizationB],
  );
  assert.equal(tenantB.rowCount, 0);

  console.log("Stripe customer tenant-binding and event-ordering regression checks passed");
} finally {
  if (organizationA || organizationB) {
    await pool.query(
      `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
      [[organizationA, organizationB].filter(Boolean)],
    );
  }
  await pool.end();
}
