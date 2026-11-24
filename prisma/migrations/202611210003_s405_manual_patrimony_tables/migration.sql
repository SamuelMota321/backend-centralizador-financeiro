CREATE TABLE public.patrimonial_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  type VARCHAR(80) NOT NULL,
  description VARCHAR(500) NOT NULL,
  estimated_value NUMERIC(19,2) NOT NULL CHECK (estimated_value >= 0),
  valuation_date DATE NOT NULL,
  source VARCHAR(120) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT patrimonial_assets_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT patrimonial_assets_text_check CHECK (
    length(btrim(type)) > 0 AND length(btrim(description)) > 0 AND length(btrim(source)) > 0
  )
);
CREATE INDEX patrimonial_assets_tenant_id_created_at_id_idx ON public.patrimonial_assets (tenant_id, created_at, id);
CREATE TRIGGER patrimonial_assets_set_updated_at BEFORE UPDATE ON public.patrimonial_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.financing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  description VARCHAR(500) NOT NULL,
  outstanding_balance NUMERIC(19,2) NOT NULL CHECK (outstanding_balance >= 0),
  asset_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT financing_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT financing_description_check CHECK (length(btrim(description)) > 0),
  CONSTRAINT financing_asset_tenant_fkey FOREIGN KEY (tenant_id, asset_id)
    REFERENCES public.patrimonial_assets(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX financing_tenant_id_created_at_id_idx ON public.financing (tenant_id, created_at, id);
CREATE TRIGGER financing_set_updated_at BEFORE UPDATE ON public.financing
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.liabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  description VARCHAR(500) NOT NULL,
  outstanding_balance NUMERIC(19,2) NOT NULL CHECK (outstanding_balance >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT liabilities_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT liabilities_description_check CHECK (length(btrim(description)) > 0)
);
CREATE INDEX liabilities_tenant_id_created_at_id_idx ON public.liabilities (tenant_id, created_at, id);
CREATE TRIGGER liabilities_set_updated_at BEFORE UPDATE ON public.liabilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.patrimonial_asset_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  asset_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  type VARCHAR(80) NOT NULL,
  description VARCHAR(500) NOT NULL,
  estimated_value NUMERIC(19,2) NOT NULL CHECK (estimated_value >= 0),
  valuation_date DATE NOT NULL,
  source VARCHAR(120) NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT patrimonial_asset_revisions_tenant_asset_version_key UNIQUE (tenant_id, asset_id, version),
  CONSTRAINT patrimonial_asset_revisions_asset_tenant_fkey FOREIGN KEY (tenant_id, asset_id)
    REFERENCES public.patrimonial_assets(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX patrimonial_asset_revisions_tenant_asset_created_idx
  ON public.patrimonial_asset_revisions (tenant_id, asset_id, created_at);

CREATE TABLE public.financing_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  financing_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  description VARCHAR(500) NOT NULL,
  outstanding_balance NUMERIC(19,2) NOT NULL CHECK (outstanding_balance >= 0),
  asset_id UUID,
  actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT financing_revisions_tenant_financing_version_key UNIQUE (tenant_id, financing_id, version),
  CONSTRAINT financing_revisions_financing_tenant_fkey FOREIGN KEY (tenant_id, financing_id)
    REFERENCES public.financing(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT financing_revisions_asset_tenant_fkey FOREIGN KEY (tenant_id, asset_id)
    REFERENCES public.patrimonial_assets(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX financing_revisions_tenant_financing_created_idx
  ON public.financing_revisions (tenant_id, financing_id, created_at);

CREATE TABLE public.liability_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  liability_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  description VARCHAR(500) NOT NULL,
  outstanding_balance NUMERIC(19,2) NOT NULL CHECK (outstanding_balance >= 0),
  actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT liability_revisions_tenant_liability_version_key UNIQUE (tenant_id, liability_id, version),
  CONSTRAINT liability_revisions_liability_tenant_fkey FOREIGN KEY (tenant_id, liability_id)
    REFERENCES public.liabilities(tenant_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX liability_revisions_tenant_liability_created_idx
  ON public.liability_revisions (tenant_id, liability_id, created_at);

ALTER TABLE public.patrimonial_assets OWNER TO cfi_owner;
ALTER TABLE public.financing OWNER TO cfi_owner;
ALTER TABLE public.liabilities OWNER TO cfi_owner;
ALTER TABLE public.patrimonial_asset_revisions OWNER TO cfi_owner;
ALTER TABLE public.financing_revisions OWNER TO cfi_owner;
ALTER TABLE public.liability_revisions OWNER TO cfi_owner;

SET ROLE cfi_owner;
REVOKE ALL ON public.patrimonial_assets, public.financing, public.liabilities,
  public.patrimonial_asset_revisions, public.financing_revisions, public.liability_revisions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.patrimonial_assets, public.financing, public.liabilities TO cfi_runtime;
GRANT SELECT, INSERT ON public.patrimonial_asset_revisions, public.financing_revisions,
  public.liability_revisions TO cfi_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patrimonial_assets, public.financing, public.liabilities TO cfi_test;
GRANT SELECT, INSERT, DELETE ON public.patrimonial_asset_revisions, public.financing_revisions,
  public.liability_revisions TO cfi_test;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'patrimonial_assets', 'financing', 'liabilities',
    'patrimonial_asset_revisions', 'financing_revisions', 'liability_revisions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id())', table_name || '_select_own', table_name);
    IF table_name LIKE '%_revisions' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO cfi_runtime, cfi_test WITH CHECK (tenant_id = app_private.current_tenant_id() AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor_user_id AND u.tenant_id = app_private.current_tenant_id()))', table_name || '_insert_own', table_name);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO cfi_runtime, cfi_test WITH CHECK (tenant_id = app_private.current_tenant_id())', table_name || '_insert_own', table_name);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO cfi_runtime, cfi_test USING (tenant_id = app_private.current_tenant_id()) WITH CHECK (tenant_id = app_private.current_tenant_id())', table_name || '_update_own', table_name);
    END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO cfi_test USING (tenant_id = app_private.current_tenant_id())', table_name || '_delete_test', table_name);
  END LOOP;
END $$;
RESET ROLE;

SET ROLE cfi_owner;
ALTER TABLE public.audit_records
  DROP CONSTRAINT IF EXISTS audit_records_metadata_object_check;

ALTER TABLE public.audit_records
  ADD CONSTRAINT audit_records_metadata_object_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 2048
    AND (
      (
        action IN ('account_updated', 'account_deactivated')
        AND resource_type = 'account'
      )
      OR
      (
        action IN ('transaction_created', 'transfer_created', 'transaction_category_updated')
        AND resource_type = 'transaction'
      )
      OR
      (
        action IN ('category_created', 'category_updated', 'category_archived')
        AND resource_type = 'category'
      )
      OR
      (
        action IN (
          'category_rule_created',
          'category_rule_updated',
          'category_rule_activated',
          'category_rule_deactivated',
          'category_rule_removed'
        )
        AND resource_type = 'category_rule'
      )
      OR
      (
        action = 'connection_lifecycle_updated'
        AND resource_type = 'connection'
      )
      OR
      (
        action IN ('patrimony_created', 'patrimony_updated')
        AND resource_type IN ('patrimonial_asset', 'financing', 'liability')
      )
    )
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
        action IN ('transaction_created', 'transfer_created')
        AND metadata ? 'changedFields'
        AND metadata - 'changedFields' = '{}'::jsonb
        AND metadata -> 'changedFields' = '[]'::jsonb
      )
      OR
      (
        action = 'transaction_category_updated'
        AND metadata ? 'changedFields'
        AND metadata - 'changedFields' = '{}'::jsonb
        AND jsonb_typeof(metadata -> 'changedFields') = 'array'
        AND (metadata -> 'changedFields') <@
          '["categoryId", "categorizationStatus", "categorizationSource"]'::jsonb
      )
      OR
      (
        action IN ('category_created', 'category_updated')
        AND metadata ? 'changedFields'
        AND metadata - 'changedFields' = '{}'::jsonb
        AND jsonb_typeof(metadata -> 'changedFields') = 'array'
        AND (metadata -> 'changedFields') <@ '["name"]'::jsonb
      )
      OR
      (
        action = 'category_archived'
        AND metadata ? 'stateTransition'
        AND metadata - 'stateTransition' = '{}'::jsonb
        AND metadata ->> 'stateTransition' IN ('active_to_archived', 'already_archived')
      )
      OR
      (
        action IN ('category_rule_created', 'category_rule_updated')
        AND metadata ? 'changedFields'
        AND metadata - 'changedFields' = '{}'::jsonb
        AND jsonb_typeof(metadata -> 'changedFields') = 'array'
        AND (metadata -> 'changedFields') <@
          '["categoryId", "conditionField", "conditionOperator", "conditionValue", "priority"]'::jsonb
      )
      OR
      (
        action IN ('category_rule_activated', 'category_rule_deactivated', 'category_rule_removed')
        AND metadata ? 'changedFields'
        AND metadata - 'changedFields' = '{}'::jsonb
        AND jsonb_typeof(metadata -> 'changedFields') = 'array'
        AND (metadata -> 'changedFields') <@ '["status"]'::jsonb
      )
      OR
      (
        action = 'account_deactivated'
        AND metadata ? 'stateTransition'
        AND metadata - 'stateTransition' = '{}'::jsonb
        AND metadata ->> 'stateTransition' IN ('active_to_archived', 'already_archived')
      )
      OR
      (
        action IN ('patrimony_created', 'patrimony_updated')
        AND metadata ? 'changedFields'
        AND metadata - 'changedFields' = '{}'::jsonb
        AND jsonb_typeof(metadata -> 'changedFields') = 'array'
        AND (metadata -> 'changedFields') <@
          CASE resource_type
            WHEN 'patrimonial_asset' THEN '["type","description","estimatedValue","valuationDate","source"]'::jsonb
            WHEN 'financing' THEN '["description","outstandingBalance","assetId"]'::jsonb
            WHEN 'liability' THEN '["description","outstandingBalance"]'::jsonb
            ELSE '[]'::jsonb
          END
      )
      OR
      (
        action = 'connection_lifecycle_updated'
        AND metadata ? 'stateTransition'
        AND metadata - 'stateTransition' = '{}'::jsonb
        AND (
          metadata ->> 'stateTransition' IN (
            'created_to_pending_authorization',
            'consent_updated',
            'pluggy_account_created',
            'pluggy_account_linked'
          )
          OR (
            metadata ->> 'stateTransition' ~
              '^(pending_authorization|connected|partially_available|expired|revoked|disconnected)_to_(pending_authorization|connected|partially_available|expired|revoked|disconnected)$'
            AND split_part(metadata ->> 'stateTransition', '_to_', 1)
              <> split_part(metadata ->> 'stateTransition', '_to_', 2)
          )
        )
      )
    )
  );


DROP POLICY audit_records_insert_own ON public.audit_records;
CREATE POLICY audit_records_insert_own ON public.audit_records
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (
    tenant_id = app_private.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor_user_id AND u.tenant_id = audit_records.tenant_id)
    AND CASE resource_type
      WHEN 'account' THEN EXISTS (SELECT 1 FROM public.accounts r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      WHEN 'transaction' THEN EXISTS (SELECT 1 FROM public.transactions r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      WHEN 'category' THEN EXISTS (SELECT 1 FROM public.categories r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      WHEN 'category_rule' THEN EXISTS (SELECT 1 FROM public.category_rules r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      WHEN 'connection' THEN EXISTS (SELECT 1 FROM public.connections r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      WHEN 'patrimonial_asset' THEN EXISTS (SELECT 1 FROM public.patrimonial_assets r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      WHEN 'financing' THEN EXISTS (SELECT 1 FROM public.financing r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      WHEN 'liability' THEN EXISTS (SELECT 1 FROM public.liabilities r WHERE r.id = resource_id AND r.tenant_id = audit_records.tenant_id)
      ELSE false
    END
  );
RESET ROLE;
