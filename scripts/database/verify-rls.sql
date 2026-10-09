\set ON_ERROR_STOP on

DO $$
DECLARE
  enabled_count integer;
  forced_count integer;
  policy_count integer;
  audit_owner name;
  connections_owner name;
  import_runs_owner name;
  ingestion_items_owner name;
  runtime_is_safe boolean;
  test_is_safe boolean;
BEGIN
  SELECT count(*) INTO enabled_count
  FROM pg_class
  WHERE oid IN (
    'public.tenants'::regclass,
    'public.users'::regclass,
    'public.identity_links'::regclass,
    'public.accounts'::regclass,
    'public.audit_records'::regclass,
    'public.categories'::regclass,
    'public.transactions'::regclass,
    'public.category_rules'::regclass,
    'public.idempotency_keys'::regclass,
    'public.import_runs'::regclass,
    'public.ingestion_items'::regclass,
    'public.connections'::regclass
  )
  AND relrowsecurity;

  SELECT count(*) INTO forced_count
  FROM pg_class
  WHERE oid IN (
    'public.tenants'::regclass,
    'public.users'::regclass,
    'public.identity_links'::regclass,
    'public.accounts'::regclass,
    'public.audit_records'::regclass,
    'public.categories'::regclass,
    'public.transactions'::regclass,
    'public.category_rules'::regclass,
    'public.idempotency_keys'::regclass,
    'public.import_runs'::regclass,
    'public.ingestion_items'::regclass,
    'public.connections'::regclass
  )
  AND relforcerowsecurity;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'tenants',
      'users',
      'identity_links',
      'accounts',
      'audit_records',
      'categories',
      'transactions',
      'category_rules',
      'idempotency_keys',
      'import_runs',
      'ingestion_items',
      'connections'
    );

  SELECT relowner::regrole INTO audit_owner
  FROM pg_class
  WHERE oid = 'public.audit_records'::regclass;

  SELECT relowner::regrole INTO import_runs_owner
  FROM pg_class
  WHERE oid = 'public.import_runs'::regclass;

  SELECT relowner::regrole INTO connections_owner
  FROM pg_class
  WHERE oid = 'public.connections'::regclass;

  SELECT relowner::regrole INTO ingestion_items_owner
  FROM pg_class
  WHERE oid = 'public.ingestion_items'::regclass;

  SELECT (
    NOT rolsuper AND NOT rolbypassrls AND rolname = 'cfi_runtime'
  ) INTO runtime_is_safe
  FROM pg_roles
  WHERE rolname = 'cfi_runtime';

  SELECT (
    NOT rolsuper AND NOT rolbypassrls AND rolname = 'cfi_test'
  ) INTO test_is_safe
  FROM pg_roles
  WHERE rolname = 'cfi_test';

  IF enabled_count <> 12 OR forced_count <> 12 OR policy_count <> 45 THEN
    RAISE EXCEPTION 'RLS verification failed: enabled %, forced %, policies %',
      enabled_count, forced_count, policy_count;
  END IF;
  IF audit_owner <> 'cfi_owner' THEN
    RAISE EXCEPTION 'audit_records owner must be cfi_owner, got %', audit_owner;
  END IF;
  IF import_runs_owner <> 'cfi_owner' OR ingestion_items_owner <> 'cfi_owner' THEN
    RAISE EXCEPTION 'Ingestion table owners must be cfi_owner, got % and %',
      import_runs_owner, ingestion_items_owner;
  END IF;
  IF connections_owner <> 'cfi_owner' THEN
    RAISE EXCEPTION 'connections owner must be cfi_owner, got %', connections_owner;
  END IF;
  IF NOT COALESCE(runtime_is_safe, false) OR NOT COALESCE(test_is_safe, false) THEN
    RAISE EXCEPTION 'runtime/test role security attributes are unsafe';
  END IF;
  IF NOT has_table_privilege('cfi_runtime', 'public.audit_records', 'INSERT')
     OR has_table_privilege('cfi_runtime', 'public.audit_records', 'SELECT')
     OR has_table_privilege('cfi_runtime', 'public.audit_records', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.audit_records', 'DELETE') THEN
    RAISE EXCEPTION 'audit_records runtime grants are unsafe';
  END IF;
  IF NOT has_table_privilege('cfi_test', 'public.audit_records', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.audit_records', 'INSERT')
     OR has_table_privilege('cfi_test', 'public.audit_records', 'UPDATE')
     OR has_table_privilege('cfi_test', 'public.audit_records', 'DELETE') THEN
    RAISE EXCEPTION 'audit_records test grants are unsafe';
  END IF;
  IF NOT has_table_privilege('cfi_runtime', 'public.connections', 'SELECT')
     OR NOT has_table_privilege('cfi_runtime', 'public.connections', 'INSERT')
     OR NOT has_table_privilege('cfi_runtime', 'public.connections', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.connections', 'DELETE')
     OR NOT has_table_privilege('cfi_test', 'public.connections', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.connections', 'INSERT')
     OR NOT has_table_privilege('cfi_test', 'public.connections', 'UPDATE')
     OR has_table_privilege('cfi_test', 'public.connections', 'DELETE') THEN
    RAISE EXCEPTION 'connections grants are unsafe';
  END IF;
  IF NOT has_table_privilege('cfi_runtime', 'public.categories', 'SELECT')
     OR NOT has_table_privilege('cfi_runtime', 'public.categories', 'INSERT')
     OR NOT has_table_privilege('cfi_runtime', 'public.categories', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.categories', 'DELETE')
     OR NOT has_table_privilege('cfi_runtime', 'public.transactions', 'SELECT')
     OR NOT has_table_privilege('cfi_runtime', 'public.transactions', 'INSERT')
     OR NOT has_table_privilege('cfi_runtime', 'public.transactions', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.transactions', 'DELETE')
     OR NOT has_table_privilege('cfi_runtime', 'public.category_rules', 'SELECT')
     OR NOT has_table_privilege('cfi_runtime', 'public.category_rules', 'INSERT')
     OR NOT has_table_privilege('cfi_runtime', 'public.category_rules', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.category_rules', 'DELETE')
     OR NOT has_table_privilege('cfi_runtime', 'public.idempotency_keys', 'SELECT')
     OR NOT has_table_privilege('cfi_runtime', 'public.idempotency_keys', 'INSERT')
     OR NOT has_table_privilege('cfi_runtime', 'public.idempotency_keys', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.idempotency_keys', 'DELETE')
     OR NOT has_table_privilege('cfi_runtime', 'public.import_runs', 'SELECT')
     OR NOT has_table_privilege('cfi_runtime', 'public.import_runs', 'INSERT')
     OR NOT has_table_privilege('cfi_runtime', 'public.import_runs', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.import_runs', 'DELETE')
     OR NOT has_table_privilege('cfi_runtime', 'public.ingestion_items', 'SELECT')
     OR NOT has_table_privilege('cfi_runtime', 'public.ingestion_items', 'INSERT')
     OR NOT has_table_privilege('cfi_runtime', 'public.ingestion_items', 'UPDATE')
     OR has_table_privilege('cfi_runtime', 'public.ingestion_items', 'DELETE') THEN
    RAISE EXCEPTION 'transactions runtime grants are unsafe';
  END IF;
  IF NOT has_table_privilege('cfi_test', 'public.categories', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.categories', 'INSERT')
     OR NOT has_table_privilege('cfi_test', 'public.categories', 'UPDATE')
     OR NOT has_table_privilege('cfi_test', 'public.categories', 'DELETE')
     OR NOT has_table_privilege('cfi_test', 'public.transactions', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.transactions', 'INSERT')
     OR NOT has_table_privilege('cfi_test', 'public.transactions', 'UPDATE')
     OR NOT has_table_privilege('cfi_test', 'public.transactions', 'DELETE')
     OR NOT has_table_privilege('cfi_test', 'public.category_rules', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.category_rules', 'INSERT')
     OR NOT has_table_privilege('cfi_test', 'public.category_rules', 'UPDATE')
     OR NOT has_table_privilege('cfi_test', 'public.category_rules', 'DELETE')
     OR NOT has_table_privilege('cfi_test', 'public.idempotency_keys', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.idempotency_keys', 'INSERT')
     OR NOT has_table_privilege('cfi_test', 'public.idempotency_keys', 'UPDATE')
     OR NOT has_table_privilege('cfi_test', 'public.idempotency_keys', 'DELETE')
     OR NOT has_table_privilege('cfi_test', 'public.import_runs', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.import_runs', 'INSERT')
     OR NOT has_table_privilege('cfi_test', 'public.import_runs', 'UPDATE')
     OR NOT has_table_privilege('cfi_test', 'public.import_runs', 'DELETE')
     OR NOT has_table_privilege('cfi_test', 'public.ingestion_items', 'SELECT')
     OR NOT has_table_privilege('cfi_test', 'public.ingestion_items', 'INSERT')
     OR NOT has_table_privilege('cfi_test', 'public.ingestion_items', 'UPDATE')
     OR NOT has_table_privilege('cfi_test', 'public.ingestion_items', 'DELETE') THEN
    RAISE EXCEPTION 'transactions test grants are unsafe';
  END IF;
END $$;

SELECT user_id AS user_id_a, tenant_id AS tenant_id_a
FROM app_private.resolve_or_provision_identity(
  'auth0',
  'https://verify-rls.example/',
  'verify-rls-a-' || gen_random_uuid()::text
) \gset

SELECT user_id AS user_id_b, tenant_id AS tenant_id_b
FROM app_private.resolve_or_provision_identity(
  'auth0',
  'https://verify-rls.example/',
  'verify-rls-b-' || gen_random_uuid()::text
) \gset

SELECT set_config('verify.tenant_id_a', :'tenant_id_a', false);
SELECT set_config('verify.tenant_id_b', :'tenant_id_b', false);
SELECT set_config('verify.user_id_a', :'user_id_a', false);
SELECT set_config('verify.user_id_b', :'user_id_b', false);

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_a', true);
INSERT INTO public.accounts (
  tenant_id, name, type, initial_balance, initial_balance_as_of
) VALUES (
  :'tenant_id_a'::uuid, 'RLS verification', 'cash', '0.00', DATE '2026-09-01'
) RETURNING id AS account_id_a \gset
SELECT set_config('verify.account_id_a', :'account_id_a', false);
INSERT INTO public.audit_records (
  tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
  request_id, metadata
) VALUES (
  :'tenant_id_a'::uuid, :'user_id_a'::uuid, 'account_updated', 'account',
  :'account_id_a'::uuid, 'success', gen_random_uuid(),
  '{"changedFields":["name"]}'::jsonb
);
INSERT INTO public.connections (
  tenant_id, owner_user_id, provider, status
) VALUES (
  :'tenant_id_a'::uuid, :'user_id_a'::uuid, 'pluggy', 'pending_authorization'
) RETURNING id AS connection_id_a \gset
SELECT set_config('verify.connection_id_a', :'connection_id_a', false);
INSERT INTO public.audit_records (
  tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
  request_id, metadata
) VALUES (
  :'tenant_id_a'::uuid, :'user_id_a'::uuid, 'connection_lifecycle_updated',
  'connection', :'connection_id_a'::uuid, 'success', gen_random_uuid(),
  '{"stateTransition":"created_to_pending_authorization"}'::jsonb
);
INSERT INTO public.categories (tenant_id, name)
VALUES (:'tenant_id_a'::uuid, 'RLS category')
RETURNING id AS category_id_a \gset
SELECT set_config('verify.category_id_a', :'category_id_a', false);
INSERT INTO public.transactions (
  tenant_id, account_id, type, amount, occurred_on, category_id,
  categorization_status, categorization_source
) VALUES (
  :'tenant_id_a'::uuid, :'account_id_a'::uuid, 'income', '10.00', DATE '2026-09-20',
  :'category_id_a'::uuid, 'categorized', 'manual'
) RETURNING id AS transaction_id_a \gset
SELECT set_config('verify.transaction_id_a', :'transaction_id_a', false);
INSERT INTO public.import_runs (
  tenant_id, status, ofx_variant, file_size_bytes, content_sha256, total_items
) VALUES (
  :'tenant_id_a'::uuid, 'preview_ready', 'ofx_1_sgml', 1, repeat('a', 64), 1
) RETURNING id AS import_run_id_a \gset
SELECT set_config('verify.import_run_id_a', :'import_run_id_a', false);
INSERT INTO public.ingestion_items (
  tenant_id, import_run_id, ordinal, type, amount, occurred_on
) VALUES (
  :'tenant_id_a'::uuid, :'import_run_id_a'::uuid, 1, 'expense', '1.00', DATE '2026-09-20'
) RETURNING id AS ingestion_item_id_a \gset
SELECT set_config('verify.ingestion_item_id_a', :'ingestion_item_id_a', false);
INSERT INTO public.category_rules (
  tenant_id, category_id, condition_field, condition_operator, condition_value
) VALUES (
  :'tenant_id_a'::uuid, :'category_id_a'::uuid, 'description', 'contains', 'RLS'
) RETURNING id AS category_rule_id_a \gset
SELECT set_config('verify.category_rule_id_a', :'category_rule_id_a', false);
COMMIT;

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_b', true);
INSERT INTO public.accounts (
  tenant_id, name, type, initial_balance, initial_balance_as_of
) VALUES (
  :'tenant_id_b'::uuid, 'RLS verification foreign resource', 'cash', '0.00', DATE '2026-09-01'
) RETURNING id AS account_id_b \gset
SELECT set_config('verify.account_id_b', :'account_id_b', false);
INSERT INTO public.connections (
  tenant_id, owner_user_id, provider, status
) VALUES (
  :'tenant_id_b'::uuid, :'user_id_b'::uuid, 'pluggy', 'pending_authorization'
) RETURNING id AS connection_id_b \gset
SELECT set_config('verify.connection_id_b', :'connection_id_b', false);
COMMIT;

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_a', true);
SELECT count(*) AS own_account_count
FROM public.accounts
WHERE id = :'account_id_a'::uuid;
SELECT count(*) AS own_connection_count
FROM public.connections
WHERE id = :'connection_id_a'::uuid;
SELECT count(*) AS own_audit_count
FROM public.audit_records
WHERE resource_id = :'account_id_a'::uuid;
SELECT count(*) AS own_category_count
FROM public.categories
WHERE id = :'category_id_a'::uuid;
SELECT count(*) AS own_transaction_count
FROM public.transactions
WHERE id = :'transaction_id_a'::uuid;
SELECT count(*) AS own_category_rule_count
FROM public.category_rules
WHERE id = :'category_rule_id_a'::uuid;
SELECT count(*) AS own_import_run_count
FROM public.import_runs
WHERE id = :'import_run_id_a'::uuid;
SELECT count(*) AS own_ingestion_item_count
FROM public.ingestion_items
WHERE id = :'ingestion_item_id_a'::uuid;
DO $$
DECLARE
  run_count integer;
  item_count integer;
BEGIN
  SELECT count(*) INTO run_count
  FROM public.import_runs
  WHERE id = current_setting('verify.import_run_id_a')::uuid;
  SELECT count(*) INTO item_count
  FROM public.ingestion_items
  WHERE id = current_setting('verify.ingestion_item_id_a')::uuid;
  IF run_count <> 1 OR item_count <> 1 THEN
    RAISE EXCEPTION 'tenant cannot read its own ingestion rows';
  END IF;
END $$;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.connections
      WHERE id = current_setting('verify.connection_id_a')::uuid) <> 1 THEN
    RAISE EXCEPTION 'tenant cannot read its own connection';
  END IF;
END $$;
DO $$
BEGIN
  UPDATE public.accounts
  SET tenant_id = current_setting('verify.tenant_id_b')::uuid
  WHERE id = current_setting('verify.account_id_a')::uuid;
  RAISE EXCEPTION 'cross-tenant ownership update unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
DO $$
BEGIN
  INSERT INTO public.connections (
    tenant_id, owner_user_id, provider, status
  ) VALUES (
    current_setting('verify.tenant_id_a')::uuid,
    current_setting('verify.user_id_b')::uuid,
    'pluggy',
    'pending_authorization'
  );
  RAISE EXCEPTION 'connection with a foreign owner unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_b', true);
SELECT count(*) AS foreign_account_count
FROM public.accounts
WHERE id = :'account_id_a'::uuid;
SELECT count(*) AS foreign_connection_count
FROM public.connections
WHERE id = :'connection_id_a'::uuid;
SELECT count(*) AS foreign_audit_count
FROM public.audit_records
WHERE resource_id = :'account_id_a'::uuid;
SELECT count(*) AS foreign_category_count
FROM public.categories
WHERE id = :'category_id_a'::uuid;
SELECT count(*) AS foreign_transaction_count
FROM public.transactions
WHERE id = :'transaction_id_a'::uuid;
SELECT count(*) AS foreign_category_rule_count
FROM public.category_rules
WHERE id = :'category_rule_id_a'::uuid;
SELECT count(*) AS foreign_import_run_count
FROM public.import_runs
WHERE id = :'import_run_id_a'::uuid;
SELECT count(*) AS foreign_ingestion_item_count
FROM public.ingestion_items
WHERE id = :'ingestion_item_id_a'::uuid;
DO $$
DECLARE
  run_count integer;
  item_count integer;
  connection_count integer;
  affected_rows integer;
BEGIN
  SELECT count(*) INTO run_count
  FROM public.import_runs
  WHERE id = current_setting('verify.import_run_id_a')::uuid;
  SELECT count(*) INTO item_count
  FROM public.ingestion_items
  WHERE id = current_setting('verify.ingestion_item_id_a')::uuid;
  SELECT count(*) INTO connection_count
  FROM public.connections
  WHERE id = current_setting('verify.connection_id_a')::uuid;
  IF run_count <> 0 OR item_count <> 0 OR connection_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant ingestion rows were visible';
  END IF;

  UPDATE public.accounts
  SET name = 'cross-tenant update'
  WHERE id = current_setting('verify.account_id_a')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'cross-tenant account update unexpectedly affected % rows', affected_rows;
  END IF;

  DELETE FROM public.accounts
  WHERE id = current_setting('verify.account_id_a')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'cross-tenant account delete unexpectedly affected % rows', affected_rows;
  END IF;
  UPDATE public.categories
  SET name = 'cross-tenant category update'
  WHERE id = current_setting('verify.category_id_a')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'cross-tenant category update unexpectedly affected % rows', affected_rows;
  END IF;
  UPDATE public.transactions
  SET description = 'cross-tenant transaction update'
  WHERE id = current_setting('verify.transaction_id_a')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'cross-tenant transaction update unexpectedly affected % rows', affected_rows;
  END IF;
  UPDATE public.category_rules
  SET priority = 1
  WHERE id = current_setting('verify.category_rule_id_a')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'cross-tenant category rule update unexpectedly affected % rows', affected_rows;
  END IF;

  UPDATE public.import_runs
  SET status = 'expired', terminal_at = CURRENT_TIMESTAMP,
      retention_expires_at = CURRENT_TIMESTAMP + INTERVAL '90 days'
  WHERE id = current_setting('verify.import_run_id_a')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'cross-tenant import run update unexpectedly affected % rows', affected_rows;
  END IF;

  UPDATE public.ingestion_items
  SET status = 'failed', error_code = 'rls_test'
  WHERE id = current_setting('verify.ingestion_item_id_a')::uuid;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'cross-tenant ingestion item update unexpectedly affected % rows', affected_rows;
  END IF;
END $$;
DO $$
BEGIN
  INSERT INTO public.audit_records (
    tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
    request_id, metadata
  ) VALUES (
    current_setting('verify.tenant_id_a')::uuid,
    current_setting('verify.user_id_a')::uuid,
    'account_updated', 'account',
    current_setting('verify.account_id_a')::uuid, 'success', gen_random_uuid(),
    '{"changedFields":[]}'::jsonb
  );
  RAISE EXCEPTION 'cross-tenant audit insert unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
DO $$
BEGIN
  UPDATE public.connections
  SET status = 'disconnected'
  WHERE id = current_setting('verify.connection_id_a')::uuid;
  IF FOUND THEN
    RAISE EXCEPTION 'cross-tenant connection update unexpectedly affected a row';
  END IF;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_a', true);
DO $$
BEGIN
  INSERT INTO public.audit_records (
    tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
    request_id, metadata
  ) VALUES (
    current_setting('verify.tenant_id_a')::uuid,
    current_setting('verify.user_id_b')::uuid,
    'account_updated', 'account',
    current_setting('verify.account_id_a')::uuid, 'success', gen_random_uuid(),
    '{"changedFields":["name"]}'::jsonb
  );
  RAISE EXCEPTION 'audit insert with a foreign actor unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
DO $$
BEGIN
  INSERT INTO public.audit_records (
    tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
    request_id, metadata
  ) VALUES (
    current_setting('verify.tenant_id_a')::uuid,
    current_setting('verify.user_id_a')::uuid,
    'connection_lifecycle_updated', 'connection',
    current_setting('verify.connection_id_b')::uuid, 'success', gen_random_uuid(),
    '{"stateTransition":"created_to_pending_authorization"}'::jsonb
  );
  RAISE EXCEPTION 'audit insert with a foreign connection unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_a', true);
DO $$
BEGIN
  INSERT INTO public.audit_records (
    tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
    request_id, metadata
  ) VALUES (
    current_setting('verify.tenant_id_a')::uuid,
    current_setting('verify.user_id_a')::uuid,
    'account_updated', 'account',
    current_setting('verify.account_id_b')::uuid, 'success', gen_random_uuid(),
    '{"changedFields":["name"]}'::jsonb
  );
  RAISE EXCEPTION 'audit insert with a foreign resource unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('app.current_tenant_id', 'malformed-context', true);
SELECT count(*) AS malformed_context_count FROM public.accounts;
DO $$
BEGIN
  INSERT INTO public.audit_records (
    tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
    request_id, metadata
  ) VALUES (
    current_setting('verify.tenant_id_a')::uuid,
    current_setting('verify.user_id_a')::uuid,
    'account_updated', 'account',
    current_setting('verify.account_id_a')::uuid, 'success', gen_random_uuid(),
    '{"changedFields":[]}'::jsonb
  );
  RAISE EXCEPTION 'audit insert without valid context unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
ROLLBACK;

BEGIN;
SELECT count(*) AS absent_context_count FROM public.accounts;
DO $$
BEGIN
  INSERT INTO public.audit_records (
    tenant_id, actor_user_id, action, resource_type, resource_id, outcome,
    request_id, metadata
  ) VALUES (
    current_setting('verify.tenant_id_a')::uuid,
    current_setting('verify.user_id_a')::uuid,
    'account_updated', 'account',
    current_setting('verify.account_id_a')::uuid, 'success', gen_random_uuid(),
    '{"changedFields":[]}'::jsonb
  );
  RAISE EXCEPTION 'audit insert without context unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
ROLLBACK;

DO $$
BEGIN
  UPDATE public.audit_records
  SET metadata = '{"changedFields":[]}'::jsonb;
  RAISE EXCEPTION 'audit update unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.audit_records;
  RAISE EXCEPTION 'audit delete unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
