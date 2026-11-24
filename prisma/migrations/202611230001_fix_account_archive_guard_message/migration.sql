BEGIN;

SET ROLE cfi_owner;

CREATE OR REPLACE FUNCTION public.prevent_account_archive_with_active_category_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.archived_at IS NULL
    AND NEW.archived_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.category_rules AS rule
      WHERE rule.tenant_id = NEW.tenant_id
        AND rule.condition_field = 'account_id'
        AND lower(rule.condition_value) = lower(NEW.id::text)
        AND rule.status = 'active'
    )
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'accounts_active_category_rules_archive_check',
      ERRCODE = '23514',
      CONSTRAINT = 'accounts_active_category_rules_archive_check';
  END IF;

  RETURN NEW;
END $$;

RESET ROLE;

COMMIT;
