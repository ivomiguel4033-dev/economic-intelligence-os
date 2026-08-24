CREATE TABLE IF NOT EXISTS ai_board_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  synthesis text,
  dissent jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence double precision,
  total_input_tokens bigint NOT NULL DEFAULT 0,
  total_output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ai_board_run_status CHECK (status IN ('running','completed','failed')),
  CONSTRAINT ai_board_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE TABLE IF NOT EXISTS ai_board_opinions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES ai_board_runs(id) ON DELETE CASCADE,
  role text NOT NULL,
  provider text,
  model text,
  recommendation text NOT NULL,
  reasoning text NOT NULL,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_board_opinion_confidence CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS ai_board_runs_org_decision_idx ON ai_board_runs (organization_id, decision_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_board_opinions_run_idx ON ai_board_opinions (run_id);
