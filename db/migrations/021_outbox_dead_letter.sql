ALTER TABLE execution_outbox
  DROP CONSTRAINT execution_outbox_status_check;

ALTER TABLE execution_outbox
  ADD CONSTRAINT execution_outbox_status_check
  CHECK (status IN ('pending','processing','delivered','failed','dead_lettered'));

ALTER TABLE execution_outbox
  ADD COLUMN dead_lettered_at timestamptz;

ALTER TABLE execution_outbox
  ADD CONSTRAINT execution_outbox_dead_letter_consistency CHECK (
    (status = 'dead_lettered' AND dead_lettered_at IS NOT NULL)
    OR
    (status <> 'dead_lettered' AND dead_lettered_at IS NULL)
  );

CREATE INDEX execution_outbox_dead_letter_idx
  ON execution_outbox (organization_id, dead_lettered_at DESC)
  WHERE status = 'dead_lettered';
