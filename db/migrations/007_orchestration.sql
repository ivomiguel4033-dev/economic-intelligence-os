CREATE TABLE IF NOT EXISTS orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  phase text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0,
  board_confidence double precision,
  consensus_agreement double precision,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orchestration_phase CHECK (phase IN ('blocked','approval-required','ready-to-execute')),
  CONSTRAINT orchestration_board_conf CHECK (board_confidence IS NULL OR (board_confidence >= 0 AND board_confidence <= 1)),
  CONSTRAINT orchestration_consensus CHECK (consensus_agreement IS NULL OR (consensus_agreement >= 0 AND consensus_agreement <= 1))
);

CREATE TABLE IF NOT EXISTS routing_champions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability text NOT NULL,
  task_type text NOT NULL,
  candidate_id text NOT NULL,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(capability, task_type)
);

CREATE INDEX IF NOT EXISTS orchestration_runs_org_decision_idx ON orchestration_runs (organization_id, decision_id, created_at DESC);
