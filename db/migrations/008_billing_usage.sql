CREATE TABLE IF NOT EXISTS billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  monthly_price_cents integer NOT NULL DEFAULT 0,
  included_ai_cost_usd numeric(12,4) NOT NULL DEFAULT 0,
  included_decisions integer NOT NULL DEFAULT 0,
  hard_monthly_ai_cost_usd numeric(12,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES billing_plans(id),
  external_customer_id text,
  external_subscription_id text,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_status CHECK (status IN ('trialing','active','past_due','paused','cancelled'))
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL,
  orchestration_run_id uuid REFERENCES orchestration_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  capability text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  billable_units numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_ledger_org_created_idx ON usage_ledger (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_ledger_decision_idx ON usage_ledger (decision_id, created_at DESC);
