ALTER TABLE execution_idempotency
  DROP CONSTRAINT IF EXISTS execution_idempotency_pkey;

ALTER TABLE execution_idempotency
  ADD CONSTRAINT execution_idempotency_pkey
  PRIMARY KEY (organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS execution_idempotency_key_idx
  ON execution_idempotency (idempotency_key);
