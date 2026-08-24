CREATE TABLE IF NOT EXISTS knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  external_ref text,
  title text NOT NULL,
  uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, ordinal)
);

CREATE TABLE IF NOT EXISTS decision_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  metric text NOT NULL,
  expected_value numeric,
  realized_value numeric,
  unit text,
  observed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_sources_org_idx ON knowledge_sources (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_chunks_org_source_idx ON knowledge_chunks (organization_id, source_id, ordinal);
CREATE INDEX IF NOT EXISTS decision_outcomes_org_decision_idx ON decision_outcomes (organization_id, decision_id, observed_at DESC);
