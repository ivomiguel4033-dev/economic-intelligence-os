CREATE TABLE IF NOT EXISTS execution_leases (
  lease_key text PRIMARY KEY,
  owner_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT execution_lease_expiry CHECK (expires_at > acquired_at)
);

CREATE INDEX IF NOT EXISTS execution_leases_expiry_idx ON execution_leases (expires_at);
