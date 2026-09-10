CREATE OR REPLACE FUNCTION public.assert_tenant_has_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE checked_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    checked_tenant := NEW.id;
  ELSIF TG_TABLE_NAME = 'users' THEN
    checked_tenant := OLD.tenant_id;
  ELSE
    RAISE EXCEPTION 'assert_tenant_has_user called for unsupported table %', TG_TABLE_NAME;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = checked_tenant)
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.tenant_id = checked_tenant) THEN
    RAISE EXCEPTION 'tenant must have exactly one user' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'users' THEN
    IF TG_OP = 'UPDATE'
       AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id)
       AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'tenant must have exactly one user' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END $$;

ALTER FUNCTION public.assert_tenant_has_user() OWNER TO cfi_owner;
