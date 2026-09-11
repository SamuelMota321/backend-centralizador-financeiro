CREATE TYPE public.audit_action AS ENUM ('account_updated', 'account_deactivated');
CREATE TYPE public.audit_resource_type AS ENUM ('account');
CREATE TYPE public.audit_outcome AS ENUM ('success');

CREATE TABLE public.audit_records (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  action public.audit_action NOT NULL,
  resource_type public.audit_resource_type NOT NULL,
  resource_id UUID NOT NULL,
  outcome public.audit_outcome NOT NULL,
  request_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_records_pkey PRIMARY KEY (id),
  CONSTRAINT audit_records_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT audit_records_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT audit_records_resource_id_fkey
    FOREIGN KEY (resource_id) REFERENCES public.accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT audit_records_metadata_object_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 2048
    AND (
      (
        action = 'account_updated'
        AND metadata ? 'changedFields'
        AND metadata - 'changedFields' = '{}'::jsonb
        AND jsonb_typeof(metadata -> 'changedFields') = 'array'
        AND (metadata -> 'changedFields') <@
          '["name", "type", "institutionName", "initialBalance", "initialBalanceAsOf"]'::jsonb
      )
      OR
      (
        action = 'account_deactivated'
        AND metadata ? 'stateTransition'
        AND metadata - 'stateTransition' = '{}'::jsonb
        AND metadata ->> 'stateTransition' IN ('active_to_archived', 'already_archived')
      )
    )
  )
);

CREATE INDEX audit_records_tenant_created_at_id_idx
  ON public.audit_records (tenant_id, created_at, id);
CREATE INDEX audit_records_tenant_resource_created_at_idx
  ON public.audit_records (tenant_id, resource_id, created_at);
CREATE INDEX audit_records_request_id_idx
  ON public.audit_records (request_id);

ALTER TYPE public.audit_action OWNER TO cfi_owner;
ALTER TYPE public.audit_resource_type OWNER TO cfi_owner;
ALTER TYPE public.audit_outcome OWNER TO cfi_owner;
ALTER TABLE public.audit_records OWNER TO cfi_owner;

SET ROLE cfi_owner;

REVOKE ALL ON public.audit_records FROM PUBLIC;
GRANT INSERT ON public.audit_records TO cfi_runtime;
GRANT SELECT, INSERT ON public.audit_records TO cfi_test;

ALTER TABLE public.audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_records FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_records_select_test ON public.audit_records
  FOR SELECT TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY audit_records_insert_own ON public.audit_records
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
