CREATE TYPE public.pluggy_sync_run_status AS ENUM (
  'queued', 'running', 'action_required', 'succeeded', 'partial', 'failed'
);
CREATE TYPE public.pluggy_sync_trigger AS ENUM ('manual', 'daily');

CREATE TABLE public.pluggy_sync_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  trigger public.pluggy_sync_trigger NOT NULL,
  civil_date DATE,
  status public.pluggy_sync_run_status NOT NULL DEFAULT 'queued',
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_date TIMESTAMPTZ(3),
  accepted_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ(3),
  completed_at TIMESTAMPTZ(3),
  retention_expires_at TIMESTAMPTZ(3),
  update_requested_at TIMESTAMPTZ(3),
  lease_until TIMESTAMPTZ(3),
  CONSTRAINT pluggy_sync_runs_pkey PRIMARY KEY (id),
  CONSTRAINT pluggy_sync_runs_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pluggy_sync_runs_daily_key UNIQUE (tenant_id, connection_id, trigger, civil_date),
  CONSTRAINT pluggy_sync_runs_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_sync_runs_connection_tenant_fkey FOREIGN KEY (tenant_id, connection_id)
    REFERENCES public.connections(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_sync_runs_owner_user_id_fkey FOREIGN KEY (owner_user_id)
    REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_sync_runs_daily_shape_check CHECK (
    (trigger = 'daily' AND civil_date IS NOT NULL) OR
    (trigger = 'manual' AND civil_date IS NULL)
  ),
  CONSTRAINT pluggy_sync_runs_terminal_shape_check CHECK (
    (status IN ('action_required', 'succeeded', 'partial', 'failed')
      AND completed_at IS NOT NULL AND retention_expires_at IS NOT NULL AND lease_until IS NULL)
    OR
    (status IN ('queued', 'running')
      AND completed_at IS NULL AND retention_expires_at IS NULL)
  )
);
CREATE UNIQUE INDEX pluggy_sync_runs_one_active_key
  ON public.pluggy_sync_runs (tenant_id, connection_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX pluggy_sync_runs_latest_idx
  ON public.pluggy_sync_runs (tenant_id, connection_id, accepted_at);
CREATE INDEX pluggy_sync_runs_retention_idx
  ON public.pluggy_sync_runs (tenant_id, retention_expires_at);

CREATE TABLE public.pluggy_account_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  provider_account_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(80) NOT NULL,
  balance NUMERIC(19,2) NOT NULL,
  currency_code VARCHAR(3) NOT NULL,
  reference_date TIMESTAMPTZ(3) NOT NULL,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pluggy_account_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT pluggy_account_snapshots_identity_key UNIQUE (tenant_id, connection_id, provider_account_id),
  CONSTRAINT pluggy_account_snapshots_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_account_snapshots_connection_tenant_fkey FOREIGN KEY (tenant_id, connection_id)
    REFERENCES public.connections(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE public.pluggy_investments (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(80) NOT NULL,
  subtype VARCHAR(80),
  balance NUMERIC(19,2) NOT NULL,
  currency_code VARCHAR(3),
  quantity NUMERIC(28,8),
  amount NUMERIC(19,2),
  amount_original NUMERIC(19,2),
  amount_profit NUMERIC(19,2),
  institution_name VARCHAR(255),
  rate NUMERIC(19,8),
  rate_type VARCHAR(80),
  maturity_date DATE,
  reference_date TIMESTAMPTZ(3),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pluggy_investments_pkey PRIMARY KEY (id),
  CONSTRAINT pluggy_investments_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pluggy_investments_identity_key UNIQUE (tenant_id, connection_id, provider_id),
  CONSTRAINT pluggy_investments_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_investments_connection_tenant_fkey FOREIGN KEY (tenant_id, connection_id)
    REFERENCES public.connections(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE public.pluggy_investment_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  investment_id UUID NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  type VARCHAR(80) NOT NULL,
  amount NUMERIC(19,2) NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pluggy_investment_movements_pkey PRIMARY KEY (id),
  CONSTRAINT pluggy_investment_movements_identity_key UNIQUE (tenant_id, connection_id, investment_id, provider_id),
  CONSTRAINT pluggy_investment_movements_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_investment_movements_connection_tenant_fkey FOREIGN KEY (tenant_id, connection_id)
    REFERENCES public.connections(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_investment_movements_investment_tenant_fkey FOREIGN KEY (tenant_id, investment_id)
    REFERENCES public.pluggy_investments(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER pluggy_account_snapshots_set_updated_at BEFORE UPDATE ON public.pluggy_account_snapshots
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_investments_set_updated_at BEFORE UPDATE ON public.pluggy_investments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_investment_movements_set_updated_at BEFORE UPDATE ON public.pluggy_investment_movements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pluggy_sync_runs OWNER TO cfi_owner;
ALTER TABLE public.pluggy_account_snapshots OWNER TO cfi_owner;
ALTER TABLE public.pluggy_investments OWNER TO cfi_owner;
ALTER TABLE public.pluggy_investment_movements OWNER TO cfi_owner;
ALTER TYPE public.pluggy_sync_run_status OWNER TO cfi_owner;
ALTER TYPE public.pluggy_sync_trigger OWNER TO cfi_owner;

SET ROLE cfi_owner;
REVOKE ALL ON public.pluggy_sync_runs, public.pluggy_account_snapshots,
  public.pluggy_investments, public.pluggy_investment_movements FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.pluggy_sync_runs, public.pluggy_account_snapshots,
  public.pluggy_investments, public.pluggy_investment_movements TO cfi_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pluggy_sync_runs, public.pluggy_account_snapshots,
  public.pluggy_investments, public.pluggy_investment_movements TO cfi_test;

ALTER TABLE public.pluggy_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_sync_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_account_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_account_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_investments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_investment_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_investment_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY pluggy_sync_runs_select_own ON public.pluggy_sync_runs
  FOR SELECT TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_sync_runs_insert_own ON public.pluggy_sync_runs
  FOR INSERT TO cfi_runtime, cfi_test WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_sync_runs_update_own ON public.pluggy_sync_runs
  FOR UPDATE TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_sync_runs_delete_test ON public.pluggy_sync_runs
  FOR DELETE TO cfi_test USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY pluggy_account_snapshots_select_own ON public.pluggy_account_snapshots
  FOR SELECT TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_account_snapshots_insert_own ON public.pluggy_account_snapshots
  FOR INSERT TO cfi_runtime, cfi_test WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_account_snapshots_update_own ON public.pluggy_account_snapshots
  FOR UPDATE TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_account_snapshots_delete_test ON public.pluggy_account_snapshots
  FOR DELETE TO cfi_test USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY pluggy_investments_select_own ON public.pluggy_investments
  FOR SELECT TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_investments_insert_own ON public.pluggy_investments
  FOR INSERT TO cfi_runtime, cfi_test WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_investments_update_own ON public.pluggy_investments
  FOR UPDATE TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_investments_delete_test ON public.pluggy_investments
  FOR DELETE TO cfi_test USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY pluggy_investment_movements_select_own ON public.pluggy_investment_movements
  FOR SELECT TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_investment_movements_insert_own ON public.pluggy_investment_movements
  FOR INSERT TO cfi_runtime, cfi_test WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_investment_movements_update_own ON public.pluggy_investment_movements
  FOR UPDATE TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_investment_movements_delete_test ON public.pluggy_investment_movements
  FOR DELETE TO cfi_test USING (tenant_id = app_private.current_tenant_id());
RESET ROLE;

-- Only the signed daily worker uses this limited cross-tenant enumeration.
SET ROLE cfi_owner;
GRANT CREATE ON SCHEMA app_private TO cfi_identity_provisioner;
GRANT SELECT ON public.connections TO cfi_identity_provisioner;
GRANT SELECT, DELETE ON public.pluggy_sync_runs TO cfi_identity_provisioner;
RESET ROLE;
CREATE FUNCTION app_private.list_daily_pluggy_sync_targets()
RETURNS TABLE (tenant_id UUID, owner_user_id UUID, connection_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog
AS $$
  SELECT c.tenant_id, c.owner_user_id, c.id
  FROM public.connections AS c
  WHERE c.status IN ('connected', 'partially_available')
    AND c.consent_status = 'granted'
    AND (c.consent_expires_at IS NULL OR c.consent_expires_at > CURRENT_TIMESTAMP)
    AND c.provider_item_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION app_private.list_daily_pluggy_sync_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.list_daily_pluggy_sync_targets() TO cfi_runtime, cfi_test;
ALTER FUNCTION app_private.list_daily_pluggy_sync_targets() OWNER TO cfi_identity_provisioner;
CREATE FUNCTION app_private.prune_expired_pluggy_sync_runs()
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH deleted AS (
    DELETE FROM public.pluggy_sync_runs
    WHERE retention_expires_at < CURRENT_TIMESTAMP
      AND status IN ('action_required', 'succeeded', 'partial', 'failed')
    RETURNING id
  ) SELECT count(*)::integer FROM deleted
$$;
REVOKE ALL ON FUNCTION app_private.prune_expired_pluggy_sync_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.prune_expired_pluggy_sync_runs() TO cfi_runtime, cfi_test;
ALTER FUNCTION app_private.prune_expired_pluggy_sync_runs() OWNER TO cfi_identity_provisioner;
SET ROLE cfi_owner;
REVOKE CREATE ON SCHEMA app_private FROM cfi_identity_provisioner;
RESET ROLE;
