BEGIN;

SET ROLE cfi_owner;

ALTER TABLE public.category_rules
  ADD CONSTRAINT category_rules_type_condition_value_check
  CHECK (
    condition_field <> 'type'
    OR condition_value IN ('income', 'expense')
  );

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
    RAISE EXCEPTION 'Account is referenced by active category rules.'
      USING ERRCODE = '23514',
            CONSTRAINT = 'accounts_active_category_rules_archive_check',
            MESSAGE = 'accounts_active_category_rules_archive_check';
  END IF;

  RETURN NEW;
END $$;

ALTER FUNCTION public.prevent_account_archive_with_active_category_rules()
  OWNER TO cfi_owner;

CREATE TRIGGER accounts_active_category_rules_archive_guard
BEFORE UPDATE OF archived_at ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.prevent_account_archive_with_active_category_rules();

RESET ROLE;

COMMIT;
