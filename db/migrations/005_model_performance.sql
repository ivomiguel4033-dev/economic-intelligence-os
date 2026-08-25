CREATE TABLE IF NOT EXISTS model_performance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  capability text NOT NULL,
  task_type text NOT NULL,
  success boolean NOT NULL,
  quality_score double precision,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  outcome_score double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_quality_score CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1)),
  CONSTRAINT model_outcome_score CHECK (outcome_score IS NULL OR (outcome_score >= 0 AND outcome_score <= 1))
);

CREATE INDEX IF NOT EXISTS model_perf_lookup_idx ON model_performance_events (capability, task_type, provider, model, created_at DESC);
CREATE INDEX IF NOT EXISTS model_perf_org_idx ON model_performance_events (organization_id, created_at DESC);
