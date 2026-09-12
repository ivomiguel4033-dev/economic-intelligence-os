ALTER TABLE billing_webhook_events
  ADD COLUMN IF NOT EXISTS retry_started_at timestamptz;

CREATE INDEX IF NOT EXISTS billing_events_retry_recovery_idx
  ON billing_webhook_events (retry_started_at)
  WHERE processed_at IS NULL AND processing_error IS NOT NULL;
