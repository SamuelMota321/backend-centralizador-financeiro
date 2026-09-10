\set ON_ERROR_STOP on

DO $$
DECLARE
  enabled_count integer;
  forced_count integer;
  policy_count integer;
BEGIN
  SELECT count(*) INTO enabled_count
  FROM pg_class
  WHERE oid IN ('public.tenants'::regclass, 'public.users'::regclass, 'public.identity_links'::regclass, 'public.accounts'::regclass)
    AND relrowsecurity;

  SELECT count(*) INTO forced_count
  FROM pg_class
  WHERE oid IN ('public.tenants'::regclass, 'public.users'::regclass, 'public.identity_links'::regclass, 'public.accounts'::regclass)
    AND relforcerowsecurity;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('tenants', 'users', 'identity_links', 'accounts');

  IF enabled_count <> 4 OR forced_count <> 4 OR policy_count <> 16 THEN
    RAISE EXCEPTION 'RLS verification failed: enabled %, forced %, policies %', enabled_count, forced_count, policy_count;
  END IF;
END $$;

BEGIN;
SELECT set_config('app.current_tenant_id', '11111111-1111-4111-8111-111111111111', true);
SELECT id FROM public.accounts;
ROLLBACK;

BEGIN;
SELECT id FROM public.accounts;
ROLLBACK;
