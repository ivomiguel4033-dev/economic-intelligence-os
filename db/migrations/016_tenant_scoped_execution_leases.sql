DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM execution_leases) THEN
    RAISE EXCEPTION 'Cannot tenant-scope execution_leases while rows exist; migrate or clear leases explicitly before applying 016';
  END IF;
END $$;

ALTER TABLE execution_leases
  ADD COLUMN organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE execution_leases
  DROP CONSTRAINT execution_leases_pkey;

ALTER TABLE execution_leases
  ADD PRIMARY KEY (organization_id, lease_key);

CREATE INDEX IF NOT EXISTS execution_leases_org_expiry_idx
  ON execution_leases (organization_id, expires_at);
