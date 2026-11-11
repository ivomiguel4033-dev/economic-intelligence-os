CREATE INDEX execution_outbox_stale_processing_idx
  ON execution_outbox (claimed_at)
  WHERE status = 'processing';
