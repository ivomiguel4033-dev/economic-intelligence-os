CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES actors(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  action text NOT NULL,
  outcome text NOT NULL,
  risk_tier text NOT NULL DEFAULT 'low',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_risk_tier CHECK (risk_tier IN ('low','medium','high','critical')),
  CONSTRAINT audit_outcome CHECK (outcome IN ('allowed','denied','failed','completed'))
);

CREATE INDEX IF NOT EXISTS audit_events_org_created_idx ON audit_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_resource_idx ON audit_events (organization_id, resource_type, resource_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
