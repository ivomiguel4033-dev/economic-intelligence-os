CREATE TABLE IF NOT EXISTS execution_idempotency (
  idempotency_key text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS execution_idempotency_org_created_idx
  ON execution_idempotency (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  risk_tier text NOT NULL,
  reason text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS execution_dead_letters_org_created_idx
  ON execution_dead_letters (organization_id, created_at DESC)
  WHERE resolved_at IS NULL;
