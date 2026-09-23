SET ROLE cfi_owner;

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'transaction_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'transfer_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'transaction_category_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_archived';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_rule_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_rule_updated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_rule_activated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_rule_deactivated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'category_rule_removed';

ALTER TYPE public.audit_resource_type ADD VALUE IF NOT EXISTS 'transaction';
ALTER TYPE public.audit_resource_type ADD VALUE IF NOT EXISTS 'category';
ALTER TYPE public.audit_resource_type ADD VALUE IF NOT EXISTS 'category_rule';

ALTER TABLE public.audit_records
  DROP CONSTRAINT IF EXISTS audit_records_resource_id_fkey;

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
    )
  );

RESET ROLE;
