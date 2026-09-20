\set ON_ERROR_STOP on

DO $$
DECLARE
  enabled_count integer;
  forced_count integer;
  policy_count integer;
  audit_owner name;
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
    'public.audit_records'::regclass
  )
  AND relrowsecurity;

  SELECT count(*) INTO forced_count
  FROM pg_class
  WHERE oid IN (
    'public.tenants'::regclass,
    'public.users'::regclass,
    'public.identity_links'::regclass,
    'public.accounts'::regclass,
    'public.audit_records'::regclass
  )
  AND relforcerowsecurity;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('tenants', 'users', 'identity_links', 'accounts', 'audit_records');

  SELECT relowner::regrole INTO audit_owner
  FROM pg_class
  WHERE oid = 'public.audit_records'::regclass;

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

  IF enabled_count <> 5 OR forced_count <> 5 OR policy_count <> 18 THEN
    RAISE EXCEPTION 'RLS verification failed: enabled %, forced %, policies %',
      enabled_count, forced_count, policy_count;
  END IF;
  IF audit_owner <> 'cfi_owner' THEN
    RAISE EXCEPTION 'audit_records owner must be cfi_owner, got %', audit_owner;
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
COMMIT;

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_a', true);
SELECT count(*) AS own_account_count
FROM public.accounts
WHERE id = :'account_id_a'::uuid;
SELECT count(*) AS own_audit_count
FROM public.audit_records
WHERE resource_id = :'account_id_a'::uuid;
DO $$
BEGIN
  UPDATE public.accounts
  SET tenant_id = current_setting('verify.tenant_id_b')::uuid
  WHERE id = current_setting('verify.account_id_a')::uuid;
  RAISE EXCEPTION 'cross-tenant ownership update unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
ROLLBACK;

BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id_b', true);
SELECT count(*) AS foreign_account_count
FROM public.accounts
WHERE id = :'account_id_a'::uuid;
SELECT count(*) AS foreign_audit_count
FROM public.audit_records
WHERE resource_id = :'account_id_a'::uuid;
DO $$
DECLARE
  affected_rows integer;
BEGIN
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
