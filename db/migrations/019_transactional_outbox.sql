CREATE TABLE execution_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  execution_run_id uuid REFERENCES execution_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT NOW(),
  claimed_at timestamptz,
  claimed_by text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX execution_outbox_ready_idx
  ON execution_outbox (available_at, created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX execution_outbox_tenant_status_idx
  ON execution_outbox (organization_id, status, created_at DESC);

ALTER TABLE execution_outbox
  ADD CONSTRAINT execution_outbox_claim_consistency CHECK (
    (status = 'processing' AND claimed_at IS NOT NULL AND claimed_by IS NOT NULL)
    OR
    (status <> 'processing')
  );

ALTER TABLE execution_outbox
  ADD CONSTRAINT execution_outbox_delivery_consistency CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL)
    OR
    (status <> 'delivered')
  );
