CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES actors(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  outcome text NOT NULL,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_event_severity CHECK (severity IN ('info','warning','high','critical')),
  CONSTRAINT security_event_outcome CHECK (outcome IN ('allowed','denied','failed'))
);

CREATE INDEX IF NOT EXISTS security_events_org_created_idx ON security_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_actor_created_idx ON security_events (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_security_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'security_events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS security_events_no_update ON security_events;
CREATE TRIGGER security_events_no_update BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION prevent_security_event_mutation();
