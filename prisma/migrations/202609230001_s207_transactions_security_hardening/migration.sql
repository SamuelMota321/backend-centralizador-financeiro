DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.transactions AS t
    JOIN public.categories AS c ON c.id = t.category_id
    WHERE t.category_id IS NOT NULL
      AND (c.tenant_id <> t.tenant_id OR c.status <> 'active' OR c.archived_at IS NOT NULL)
  ) OR EXISTS (
    SELECT 1
    FROM public.category_rules AS r
    JOIN public.categories AS c ON c.id = r.category_id
    WHERE c.tenant_id <> r.tenant_id OR c.status <> 'active' OR c.archived_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.category_rules AS r
    WHERE r.condition_field = 'account_id'
      AND (
        r.condition_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR NOT EXISTS (
        SELECT 1 FROM public.accounts AS a
        WHERE a.id::text = lower(r.condition_value)
          AND a.tenant_id = r.tenant_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'existing transaction/category relationships violate tenant ownership';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_transaction_category_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.categories
  WHERE id = NEW.category_id
    AND tenant_id = NEW.tenant_id
    AND status = 'active'
    AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction category must belong to the tenant and be active'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.assert_category_rule_references_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM public.categories
  WHERE id = NEW.category_id
    AND tenant_id = NEW.tenant_id
    AND status = 'active'
    AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category rule category must belong to the tenant and be active'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.condition_field = 'account_id' THEN
    IF NEW.condition_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'category rule account must belong to the tenant'
        USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM public.accounts
    WHERE id = NEW.condition_value::uuid
      AND tenant_id = NEW.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'category rule account must belong to the tenant'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

ALTER FUNCTION public.assert_transaction_category_tenant() OWNER TO cfi_owner;
ALTER FUNCTION public.assert_category_rule_references_tenant() OWNER TO cfi_owner;

SET ROLE cfi_owner;

CREATE TRIGGER transactions_category_tenant
BEFORE INSERT OR UPDATE OF tenant_id, category_id ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.assert_transaction_category_tenant();

CREATE TRIGGER category_rules_references_tenant
BEFORE INSERT OR UPDATE OF tenant_id, category_id, condition_field, condition_value
ON public.category_rules
FOR EACH ROW EXECUTE FUNCTION public.assert_category_rule_references_tenant();

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
      ELSE false
    END
  );

RESET ROLE;
