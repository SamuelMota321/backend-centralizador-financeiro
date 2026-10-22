BEGIN;

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

RESET ROLE;

COMMIT;
