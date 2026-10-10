ALTER TABLE billing_webhook_events
  ADD COLUMN IF NOT EXISTS processing_generation bigint NOT NULL DEFAULT 1;
