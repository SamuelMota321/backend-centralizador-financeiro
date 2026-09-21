CREATE TYPE public.idempotency_status AS ENUM ('pending', 'completed');

CREATE TABLE public.idempotency_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  operation VARCHAR(100) NOT NULL,
  key VARCHAR(255) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  status public.idempotency_status NOT NULL DEFAULT 'pending',
  resource_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id),
  CONSTRAINT idempotency_keys_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT idempotency_keys_resource_ids_array_check CHECK (jsonb_typeof(resource_ids) = 'array'),
  CONSTRAINT idempotency_keys_expiration_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX idempotency_keys_tenant_operation_key_key
  ON public.idempotency_keys (tenant_id, operation, key);
CREATE INDEX idempotency_keys_tenant_expires_at_idx
  ON public.idempotency_keys (tenant_id, expires_at);

CREATE OR REPLACE FUNCTION public.assert_transaction_account_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM public.accounts
  WHERE id = NEW.account_id
    AND tenant_id = NEW.tenant_id
    AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction account must belong to the tenant and be active'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

ALTER TYPE public.idempotency_status OWNER TO cfi_owner;
ALTER TABLE public.idempotency_keys OWNER TO cfi_owner;
ALTER FUNCTION public.assert_transaction_account_active() OWNER TO cfi_owner;

SET ROLE cfi_owner;

CREATE TRIGGER transactions_account_active
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.assert_transaction_account_active();

REVOKE ALL ON public.idempotency_keys FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.idempotency_keys TO cfi_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.idempotency_keys TO cfi_test;

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_select_own ON public.idempotency_keys
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY idempotency_keys_insert_own ON public.idempotency_keys
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY idempotency_keys_update_own ON public.idempotency_keys
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY idempotency_keys_delete_test ON public.idempotency_keys
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

RESET ROLE;
