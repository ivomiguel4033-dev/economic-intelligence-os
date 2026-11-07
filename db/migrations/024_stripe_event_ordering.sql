ALTER TABLE billing_customers
  ADD COLUMN IF NOT EXISTS last_stripe_event_created_at bigint;

CREATE INDEX IF NOT EXISTS billing_customers_last_stripe_event_idx
  ON billing_customers (last_stripe_event_created_at);
