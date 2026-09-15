CREATE TABLE tenant_concurrency_leases (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, lease_token)
);

CREATE INDEX tenant_concurrency_leases_expiry_idx
  ON tenant_concurrency_leases (expires_at);

CREATE INDEX tenant_concurrency_leases_tenant_expiry_idx
  ON tenant_concurrency_leases (organization_id, expires_at);
