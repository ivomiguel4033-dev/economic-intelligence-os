CREATE TABLE IF NOT EXISTS billing_customers (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan_code text NOT NULL DEFAULT 'starter',
  subscription_state text NOT NULL DEFAULT 'trialing',
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_plan_code CHECK (plan_code IN ('starter','growth','enterprise')),
  CONSTRAINT billing_subscription_state CHECK (subscription_state IN ('trialing','active','past_due','paused','canceled'))
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  payload_hash text NOT NULL,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_customers_subscription_idx ON billing_customers (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS billing_events_unprocessed_idx ON billing_webhook_events (created_at) WHERE processed_at IS NULL;
