ALTER TABLE execution_leases
  ADD COLUMN fencing_token bigint NOT NULL DEFAULT 1;

ALTER TABLE execution_leases
  ADD CONSTRAINT execution_lease_fencing_token_positive CHECK (fencing_token > 0);
