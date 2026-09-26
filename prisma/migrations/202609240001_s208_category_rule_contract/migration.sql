SET ROLE cfi_owner;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.category_rules AS r
    JOIN public.accounts AS a
      ON a.id::text = lower(r.condition_value)
     AND a.tenant_id = r.tenant_id
    WHERE r.condition_field = 'account_id'
      AND a.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'existing category rules reference archived accounts';
  END IF;
END $$;

ALTER TABLE public.category_rules
  DROP CONSTRAINT IF EXISTS category_rules_priority_check;

ALTER TABLE public.category_rules
  ADD CONSTRAINT category_rules_priority_check
  CHECK (priority BETWEEN 0 AND 2147483647);

CREATE OR REPLACE FUNCTION public.assert_category_rule_references_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  require_active_category boolean;
BEGIN
  require_active_category := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    require_active_category := NEW.category_id IS DISTINCT FROM OLD.category_id;
  END IF;

  PERFORM 1
  FROM public.categories
  WHERE id = NEW.category_id
    AND tenant_id = NEW.tenant_id
    AND (
      NOT require_active_category
      OR (status = 'active' AND archived_at IS NULL)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category rule category must belong to the tenant and be active when assigned'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.condition_field = 'account_id' THEN
    IF NEW.condition_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'category rule account must belong to the tenant and be active'
        USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM public.accounts
    WHERE id = NEW.condition_value::uuid
      AND tenant_id = NEW.tenant_id
      AND archived_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'category rule account must belong to the tenant and be active'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

ALTER FUNCTION public.assert_category_rule_references_tenant() OWNER TO cfi_owner;

RESET ROLE;
