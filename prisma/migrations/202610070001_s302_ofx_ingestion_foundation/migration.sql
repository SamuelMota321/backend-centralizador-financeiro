CREATE TYPE public.ofx_variant AS ENUM ('ofx_1_sgml', 'ofx_2_xml');
CREATE TYPE public.import_run_status AS ENUM (
  'preview_ready',
  'queued',
  'processing',
  'completed',
  'completed_with_errors',
  'failed',
  'expired'
);
CREATE TYPE public.ingestion_item_status AS ENUM (
  'previewed',
  'imported',
  'ignored_duplicate',
  'failed'
);

ALTER TABLE public.transactions
  ADD COLUMN external_identity_key CHAR(64);

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_external_identity_key_check
  CHECK (
    external_identity_key IS NULL
    OR external_identity_key ~ '^[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX transactions_tenant_account_external_identity_key
  ON public.transactions (tenant_id, account_id, external_identity_key);

CREATE TABLE public.import_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  destination_account_id UUID,
  status public.import_run_status NOT NULL DEFAULT 'preview_ready',
  ofx_variant public.ofx_variant NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  source_object_reference TEXT,
  total_items INTEGER NOT NULL DEFAULT 0,
  imported_items INTEGER NOT NULL DEFAULT 0,
  ignored_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  terminal_at TIMESTAMPTZ(3),
  retention_expires_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT import_runs_pkey PRIMARY KEY (id),
  CONSTRAINT import_runs_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT import_runs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT import_runs_destination_account_id_fkey
    FOREIGN KEY (destination_account_id) REFERENCES public.accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT import_runs_file_size_bytes_check
    CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT import_runs_content_sha256_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_runs_item_counts_check
    CHECK (
      total_items >= 0
      AND imported_items >= 0
      AND ignored_items >= 0
      AND failed_items >= 0
      AND imported_items + ignored_items + failed_items <= total_items
    ),
  CONSTRAINT import_runs_terminal_retention_check
    CHECK (
      (status IN ('completed', 'completed_with_errors', 'failed', 'expired')
        AND terminal_at IS NOT NULL AND retention_expires_at IS NOT NULL)
      OR
      (status IN ('preview_ready', 'queued', 'processing')
        AND terminal_at IS NULL AND retention_expires_at IS NULL)
    )
);

CREATE INDEX import_runs_tenant_status_created_at_id_idx
  ON public.import_runs (tenant_id, status, created_at, id);
CREATE INDEX import_runs_tenant_retention_expires_at_idx
  ON public.import_runs (tenant_id, retention_expires_at);

CREATE TABLE public.ingestion_items (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  import_run_id UUID NOT NULL,
  ordinal INTEGER NOT NULL,
  external_id VARCHAR(255),
  type public.transaction_type NOT NULL,
  amount NUMERIC(19, 2) NOT NULL,
  occurred_on DATE NOT NULL,
  description TEXT,
  status public.ingestion_item_status NOT NULL DEFAULT 'previewed',
  is_duplicate BOOLEAN,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code VARCHAR(100),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ingestion_items_pkey PRIMARY KEY (id),
  CONSTRAINT ingestion_items_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ingestion_items_import_run_tenant_fkey
    FOREIGN KEY (tenant_id, import_run_id)
    REFERENCES public.import_runs(tenant_id, id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ingestion_items_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT ingestion_items_amount_positive_check CHECK (amount > 0),
  CONSTRAINT ingestion_items_non_transfer_type_check CHECK (type IN ('income', 'expense')),
  CONSTRAINT ingestion_items_error_shape_check
    CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT ingestion_items_duplicate_shape_check
    CHECK (
      (status = 'previewed' AND is_duplicate IS NULL)
      OR (status = 'imported' AND is_duplicate = false)
      OR (status = 'ignored_duplicate' AND is_duplicate = true)
      OR (status = 'failed' AND is_duplicate IS NULL)
    ),
  CONSTRAINT ingestion_items_warnings_array_check
    CHECK (jsonb_typeof(warnings) = 'array')
);

CREATE UNIQUE INDEX ingestion_items_tenant_run_ordinal_key
  ON public.ingestion_items (tenant_id, import_run_id, ordinal);
CREATE INDEX ingestion_items_tenant_run_status_idx
  ON public.ingestion_items (tenant_id, import_run_id, status);

CREATE OR REPLACE FUNCTION public.assert_import_run_account_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.destination_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.accounts
  WHERE id = NEW.destination_account_id
    AND tenant_id = NEW.tenant_id
    AND origin = 'manual'
    AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'import destination account must be active and locally owned by the tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

ALTER TYPE public.ofx_variant OWNER TO cfi_owner;
ALTER TYPE public.import_run_status OWNER TO cfi_owner;
ALTER TYPE public.ingestion_item_status OWNER TO cfi_owner;
ALTER TABLE public.import_runs OWNER TO cfi_owner;
ALTER TABLE public.ingestion_items OWNER TO cfi_owner;
ALTER FUNCTION public.assert_import_run_account_tenant() OWNER TO cfi_owner;

SET ROLE cfi_owner;

CREATE TRIGGER import_runs_destination_account_tenant
BEFORE INSERT OR UPDATE OF tenant_id, destination_account_id
ON public.import_runs
FOR EACH ROW EXECUTE FUNCTION public.assert_import_run_account_tenant();

REVOKE ALL ON public.import_runs, public.ingestion_items FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.import_runs, public.ingestion_items TO cfi_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_runs, public.ingestion_items TO cfi_test;

ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_items FORCE ROW LEVEL SECURITY;

CREATE POLICY import_runs_select_own ON public.import_runs
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY import_runs_insert_own ON public.import_runs
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY import_runs_update_own ON public.import_runs
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY import_runs_delete_test ON public.import_runs
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY ingestion_items_select_own ON public.ingestion_items
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY ingestion_items_insert_own ON public.ingestion_items
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY ingestion_items_update_own ON public.ingestion_items
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY ingestion_items_delete_test ON public.ingestion_items
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

RESET ROLE;
