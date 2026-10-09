CREATE TYPE public.connection_provider AS ENUM ('pluggy');
CREATE TYPE public.connection_status AS ENUM (
  'pending_authorization',
  'connected',
  'partially_available',
  'expired',
  'revoked',
  'disconnected'
);
CREATE TYPE public.consent_status AS ENUM ('granted', 'expired', 'revoked');

ALTER TYPE public.audit_action
  ADD VALUE 'connection_lifecycle_updated';
ALTER TYPE public.audit_resource_type
  ADD VALUE 'connection';

CREATE TABLE public.connections (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  provider public.connection_provider NOT NULL,
  provider_item_id UUID,
  status public.connection_status NOT NULL DEFAULT 'pending_authorization',
  consent_id UUID,
  consent_status public.consent_status,
  consent_products TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  open_finance_permissions_granted TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  consent_created_at TIMESTAMPTZ(3),
  consent_expires_at TIMESTAMPTZ(3),
  consent_revoked_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT connections_pkey PRIMARY KEY (id),
  CONSTRAINT connections_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connections_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT connections_provider_item_id_key UNIQUE (provider_item_id),
  CONSTRAINT connections_provider_reference_check
    CHECK (status IN ('pending_authorization', 'disconnected') OR provider_item_id IS NOT NULL),
  CONSTRAINT connections_consent_created_at_check
    CHECK (consent_id IS NULL OR consent_created_at IS NOT NULL)
);

CREATE INDEX connections_tenant_owner_status_idx
  ON public.connections (tenant_id, owner_user_id, status);

CREATE TRIGGER connections_set_updated_at BEFORE UPDATE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.connections OWNER TO cfi_owner;
ALTER TYPE public.connection_provider OWNER TO cfi_owner;
ALTER TYPE public.connection_status OWNER TO cfi_owner;
ALTER TYPE public.consent_status OWNER TO cfi_owner;

SET ROLE cfi_owner;

REVOKE ALL ON public.connections FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.connections TO cfi_runtime;
GRANT SELECT, INSERT, UPDATE ON public.connections TO cfi_test;

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections FORCE ROW LEVEL SECURITY;

CREATE POLICY connections_select_owner ON public.connections
  FOR SELECT TO cfi_runtime, cfi_test
  USING (
    tenant_id = app_private.current_tenant_id()
    AND owner_user_id IN (
      SELECT id FROM public.users
      WHERE tenant_id = app_private.current_tenant_id()
    )
  );
CREATE POLICY connections_insert_owner ON public.connections
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (
    tenant_id = app_private.current_tenant_id()
    AND owner_user_id IN (
      SELECT id FROM public.users
      WHERE tenant_id = app_private.current_tenant_id()
    )
  );
CREATE POLICY connections_update_owner ON public.connections
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (
    tenant_id = app_private.current_tenant_id()
    AND owner_user_id IN (
      SELECT id FROM public.users
      WHERE tenant_id = app_private.current_tenant_id()
    )
  )
  WITH CHECK (
    tenant_id = app_private.current_tenant_id()
    AND owner_user_id IN (
      SELECT id FROM public.users
      WHERE tenant_id = app_private.current_tenant_id()
    )
  );

DROP POLICY audit_records_insert_own ON public.audit_records;
CREATE POLICY audit_records_insert_own ON public.audit_records
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (
    tenant_id = app_private.current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.users AS actor
      WHERE actor.id = audit_records.actor_user_id
        AND actor.tenant_id = audit_records.tenant_id
    )
    AND CASE resource_type
      WHEN 'account'::public.audit_resource_type THEN EXISTS (
        SELECT 1 FROM public.accounts AS resource
        WHERE resource.id = audit_records.resource_id
          AND resource.tenant_id = audit_records.tenant_id
      )
      WHEN 'transaction'::public.audit_resource_type THEN EXISTS (
        SELECT 1 FROM public.transactions AS resource
        WHERE resource.id = audit_records.resource_id
          AND resource.tenant_id = audit_records.tenant_id
      )
      WHEN 'category'::public.audit_resource_type THEN EXISTS (
        SELECT 1 FROM public.categories AS resource
        WHERE resource.id = audit_records.resource_id
          AND resource.tenant_id = audit_records.tenant_id
      )
      WHEN 'category_rule'::public.audit_resource_type THEN EXISTS (
        SELECT 1 FROM public.category_rules AS resource
        WHERE resource.id = audit_records.resource_id
          AND resource.tenant_id = audit_records.tenant_id
      )
      WHEN 'connection'::public.audit_resource_type THEN EXISTS (
        SELECT 1 FROM public.connections AS resource
        WHERE resource.id = audit_records.resource_id
          AND resource.tenant_id = audit_records.tenant_id
      )
      ELSE false
    END
  );

RESET ROLE;
