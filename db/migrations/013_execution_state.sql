CREATE TABLE IF NOT EXISTS execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  action_type text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  uncertainty_reason text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  CONSTRAINT execution_run_state CHECK (state IN ('pending','running','succeeded','failed','uncertain','dead_lettered'))
);

CREATE TABLE IF NOT EXISTS execution_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_run_id uuid NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  outcome text NOT NULL,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (execution_run_id, attempt),
  CONSTRAINT execution_attempt_outcome CHECK (outcome IN ('started','succeeded','failed','uncertain'))
);

CREATE INDEX IF NOT EXISTS execution_runs_org_state_idx ON execution_runs (organization_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS execution_attempts_run_idx ON execution_attempts (execution_run_id, attempt);
