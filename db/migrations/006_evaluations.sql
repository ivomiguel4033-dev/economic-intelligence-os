CREATE TABLE IF NOT EXISTS evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  suite text NOT NULL,
  version text NOT NULL,
  score double precision NOT NULL,
  passed boolean NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_score CHECK (score >= 0 AND score <= 1)
);

CREATE TABLE IF NOT EXISTS model_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability text NOT NULL,
  task_type text NOT NULL,
  champion text NOT NULL,
  challenger text NOT NULL,
  promoted boolean NOT NULL,
  score_delta double precision NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_runs_lookup_idx ON evaluation_runs (suite, provider, model, created_at DESC);
CREATE INDEX IF NOT EXISTS model_promotions_lookup_idx ON model_promotions (capability, task_type, created_at DESC);
