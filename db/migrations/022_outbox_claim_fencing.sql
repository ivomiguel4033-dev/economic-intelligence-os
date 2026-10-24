ALTER TABLE execution_outbox
  ADD COLUMN claim_token bigint NOT NULL DEFAULT 0;

ALTER TABLE execution_outbox
  ADD CONSTRAINT execution_outbox_claim_token_nonnegative
  CHECK (claim_token >= 0);
