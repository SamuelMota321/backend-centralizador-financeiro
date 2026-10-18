CREATE TYPE public.pluggy_initial_import_status AS ENUM (
  'queued',
  'processing',
  'awaiting_account_mapping',
  'completed',
  'completed_with_errors',
  'failed'
);
CREATE TYPE public.provider_data_availability AS ENUM (
  'pending', 'available', 'unavailable', 'failed'
);
CREATE TYPE public.pluggy_account_mapping_status AS ENUM (
  'pending', 'mapped', 'unsupported'
);

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE public.connections
  ADD CONSTRAINT connections_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE public.pluggy_initial_import_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  status public.pluggy_initial_import_status NOT NULL DEFAULT 'queued',
  accounts_availability public.provider_data_availability NOT NULL DEFAULT 'pending',
  transactions_availability public.provider_data_availability NOT NULL DEFAULT 'pending',
  accounts_error_code VARCHAR(100),
  transactions_error_code VARCHAR(100),
  total_accounts INTEGER NOT NULL DEFAULT 0,
  mapped_accounts INTEGER NOT NULL DEFAULT 0,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  imported_transactions INTEGER NOT NULL DEFAULT 0,
  ignored_transactions INTEGER NOT NULL DEFAULT 0,
  failed_transactions INTEGER NOT NULL DEFAULT 0,
  terminal_at TIMESTAMPTZ(3),
  retention_expires_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pluggy_initial_import_runs_pkey PRIMARY KEY (id),
  CONSTRAINT pluggy_initial_import_runs_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pluggy_initial_import_runs_tenant_connection_key UNIQUE (tenant_id, connection_id),
  CONSTRAINT pluggy_initial_import_runs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_initial_import_runs_connection_tenant_fkey
    FOREIGN KEY (tenant_id, connection_id)
    REFERENCES public.connections(tenant_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_initial_import_runs_counts_check CHECK (
    total_accounts >= 0 AND mapped_accounts >= 0 AND mapped_accounts <= total_accounts
    AND total_transactions >= 0 AND imported_transactions >= 0
    AND ignored_transactions >= 0 AND failed_transactions >= 0
    AND imported_transactions + ignored_transactions + failed_transactions <= total_transactions
  ),
  CONSTRAINT pluggy_initial_import_runs_terminal_retention_check CHECK (
    (status IN ('completed', 'completed_with_errors', 'failed')
      AND terminal_at IS NOT NULL AND retention_expires_at IS NOT NULL)
    OR
    (status IN ('queued', 'processing', 'awaiting_account_mapping')
      AND terminal_at IS NULL AND retention_expires_at IS NULL)
  ),
  CONSTRAINT pluggy_initial_import_runs_accounts_error_shape_check CHECK (
    (accounts_availability = 'failed') = (accounts_error_code IS NOT NULL)
  ),
  CONSTRAINT pluggy_initial_import_runs_transactions_error_shape_check CHECK (
    (transactions_availability = 'failed') = (transactions_error_code IS NOT NULL)
  )
);

CREATE INDEX pluggy_initial_import_runs_tenant_status_created_at_idx
  ON public.pluggy_initial_import_runs (tenant_id, status, created_at);

CREATE TABLE public.pluggy_initial_import_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  import_run_id UUID NOT NULL,
  provider_account_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  account_type public.account_type,
  currency_code VARCHAR(3) NOT NULL,
  balance NUMERIC(19, 2),
  balance_as_of DATE,
  mapping_status public.pluggy_account_mapping_status NOT NULL DEFAULT 'pending',
  error_code VARCHAR(100),
  mapped_account_id UUID,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pluggy_initial_import_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT pluggy_initial_import_accounts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pluggy_initial_import_accounts_tenant_run_provider_key
    UNIQUE (tenant_id, import_run_id, provider_account_id),
  CONSTRAINT pluggy_initial_import_accounts_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_initial_import_accounts_run_tenant_fkey
    FOREIGN KEY (tenant_id, import_run_id)
    REFERENCES public.pluggy_initial_import_runs(tenant_id, id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT pluggy_initial_import_accounts_mapped_account_tenant_fkey
    FOREIGN KEY (tenant_id, mapped_account_id)
    REFERENCES public.accounts(tenant_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pluggy_initial_import_accounts_balance_pair_check CHECK (
    (balance IS NULL) = (balance_as_of IS NULL)
  ),
  CONSTRAINT pluggy_initial_import_accounts_mapping_shape_check CHECK (
    (mapping_status = 'pending' AND mapped_account_id IS NULL AND error_code IS NULL)
    OR (mapping_status = 'mapped' AND mapped_account_id IS NOT NULL AND error_code IS NULL)
    OR (mapping_status = 'unsupported' AND mapped_account_id IS NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX pluggy_initial_import_accounts_tenant_run_status_idx
  ON public.pluggy_initial_import_accounts (tenant_id, import_run_id, mapping_status);

CREATE TRIGGER pluggy_initial_import_runs_set_updated_at BEFORE UPDATE
ON public.pluggy_initial_import_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pluggy_initial_import_accounts_set_updated_at BEFORE UPDATE
ON public.pluggy_initial_import_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pluggy_initial_import_runs OWNER TO cfi_owner;
ALTER TABLE public.pluggy_initial_import_accounts OWNER TO cfi_owner;
ALTER TYPE public.pluggy_initial_import_status OWNER TO cfi_owner;
ALTER TYPE public.provider_data_availability OWNER TO cfi_owner;
ALTER TYPE public.pluggy_account_mapping_status OWNER TO cfi_owner;

SET ROLE cfi_owner;

REVOKE ALL ON public.pluggy_initial_import_runs, public.pluggy_initial_import_accounts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.pluggy_initial_import_runs, public.pluggy_initial_import_accounts TO cfi_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pluggy_initial_import_runs, public.pluggy_initial_import_accounts TO cfi_test;

ALTER TABLE public.pluggy_initial_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_initial_import_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_initial_import_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pluggy_initial_import_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY pluggy_initial_import_runs_select_own ON public.pluggy_initial_import_runs
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_initial_import_runs_insert_own ON public.pluggy_initial_import_runs
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_initial_import_runs_update_own ON public.pluggy_initial_import_runs
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_initial_import_runs_delete_test ON public.pluggy_initial_import_runs
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY pluggy_initial_import_accounts_select_own ON public.pluggy_initial_import_accounts
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_initial_import_accounts_insert_own ON public.pluggy_initial_import_accounts
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_initial_import_accounts_update_own ON public.pluggy_initial_import_accounts
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY pluggy_initial_import_accounts_delete_test ON public.pluggy_initial_import_accounts
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

RESET ROLE;
