ALTER TYPE public.identity_provider OWNER TO cfi_owner;
ALTER TYPE public.account_origin OWNER TO cfi_owner;
ALTER TYPE public.account_external_provider OWNER TO cfi_owner;
ALTER TYPE public.account_type OWNER TO cfi_owner;
ALTER TABLE public.tenants OWNER TO cfi_owner;
ALTER TABLE public.users OWNER TO cfi_owner;
ALTER TABLE public.identity_links OWNER TO cfi_owner;
ALTER TABLE public.accounts OWNER TO cfi_owner;
ALTER FUNCTION public.set_updated_at() OWNER TO cfi_owner;
ALTER FUNCTION public.assert_tenant_has_user() OWNER TO cfi_owner;

SET ROLE cfi_owner;

CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION cfi_owner;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA app_private TO cfi_migrator;
GRANT USAGE, CREATE ON SCHEMA app_private TO cfi_identity_provisioner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_private.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN value::uuid
    ELSE NULL
  END
  FROM (VALUES (current_setting('app.current_tenant_id', true))) AS setting(value)
$$;

ALTER FUNCTION app_private.current_tenant_id() OWNER TO cfi_owner;
REVOKE ALL ON FUNCTION app_private.current_tenant_id() FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO cfi_runtime, cfi_test;
GRANT EXECUTE ON FUNCTION app_private.current_tenant_id() TO cfi_runtime, cfi_test;
GRANT USAGE ON SCHEMA public TO cfi_runtime, cfi_identity_provisioner, cfi_test;

REVOKE ALL ON public.tenants, public.users, public.identity_links, public.accounts FROM PUBLIC;
GRANT SELECT ON public.tenants, public.users, public.identity_links, public.accounts TO cfi_runtime;
GRANT INSERT, UPDATE, DELETE ON public.accounts TO cfi_runtime;
GRANT SELECT, INSERT ON public.tenants, public.users, public.identity_links TO cfi_identity_provisioner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants, public.users, public.identity_links, public.accounts TO cfi_test;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.identity_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_select_own ON public.tenants FOR SELECT TO cfi_runtime, cfi_test
USING (id = app_private.current_tenant_id());
CREATE POLICY tenants_insert_own ON public.tenants FOR INSERT TO cfi_runtime, cfi_test
WITH CHECK (id = app_private.current_tenant_id());
CREATE POLICY tenants_update_own ON public.tenants FOR UPDATE TO cfi_runtime, cfi_test
USING (id = app_private.current_tenant_id()) WITH CHECK (id = app_private.current_tenant_id());
CREATE POLICY tenants_delete_own ON public.tenants FOR DELETE TO cfi_runtime, cfi_test
USING (id = app_private.current_tenant_id());

CREATE POLICY users_select_own ON public.users FOR SELECT TO cfi_runtime, cfi_test
USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY users_insert_own ON public.users FOR INSERT TO cfi_runtime, cfi_test
WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY users_update_own ON public.users FOR UPDATE TO cfi_runtime, cfi_test
USING (tenant_id = app_private.current_tenant_id()) WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY users_delete_own ON public.users FOR DELETE TO cfi_runtime, cfi_test
USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY identity_links_select_own ON public.identity_links FOR SELECT TO cfi_runtime, cfi_test
USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.tenant_id = app_private.current_tenant_id()));
CREATE POLICY identity_links_insert_own ON public.identity_links FOR INSERT TO cfi_runtime, cfi_test
WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.tenant_id = app_private.current_tenant_id()));
CREATE POLICY identity_links_update_own ON public.identity_links FOR UPDATE TO cfi_runtime, cfi_test
USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.tenant_id = app_private.current_tenant_id()))
WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.tenant_id = app_private.current_tenant_id()));
CREATE POLICY identity_links_delete_own ON public.identity_links FOR DELETE TO cfi_runtime, cfi_test
USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_id AND u.tenant_id = app_private.current_tenant_id()));

CREATE POLICY accounts_select_own ON public.accounts FOR SELECT TO cfi_runtime, cfi_test
USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY accounts_insert_own ON public.accounts FOR INSERT TO cfi_runtime, cfi_test
WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY accounts_update_own ON public.accounts FOR UPDATE TO cfi_runtime, cfi_test
USING (tenant_id = app_private.current_tenant_id()) WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY accounts_delete_own ON public.accounts FOR DELETE TO cfi_runtime, cfi_test
USING (tenant_id = app_private.current_tenant_id());

CREATE OR REPLACE FUNCTION app_private.resolve_or_provision_identity(
  p_provider text,
  p_issuer text,
  p_subject text
) RETURNS TABLE(user_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
BEGIN
  IF p_provider IS DISTINCT FROM 'auth0'
     OR p_issuer IS NULL OR p_issuer !~ '^https://'
     OR char_length(p_issuer) NOT BETWEEN 1 AND 255
     OR p_issuer IS DISTINCT FROM btrim(p_issuer)
     OR p_issuer ~ '[[:cntrl:]]'
     OR p_subject IS NULL
     OR char_length(p_subject) NOT BETWEEN 1 AND 255
     OR p_subject IS DISTINCT FROM btrim(p_subject)
     OR p_subject ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid identity' USING ERRCODE = '22023';
  END IF;

  LOOP
    SELECT il.user_id, u.tenant_id
      INTO v_user_id, v_tenant_id
      FROM public.identity_links AS il
      JOIN public.users AS u ON u.id = il.user_id
     WHERE il.issuer = p_issuer AND il.subject = p_subject;

    IF FOUND THEN
      RETURN QUERY SELECT v_user_id, v_tenant_id;
      RETURN;
    END IF;

    v_tenant_id := gen_random_uuid();
    v_user_id := gen_random_uuid();

    BEGIN
      INSERT INTO public.tenants (id) VALUES (v_tenant_id);
      INSERT INTO public.users (id, tenant_id) VALUES (v_user_id, v_tenant_id);
      INSERT INTO public.identity_links (id, user_id, provider, issuer, subject)
      VALUES (gen_random_uuid(), v_user_id, p_provider::public.identity_provider, p_issuer, p_subject);

      RETURN QUERY SELECT v_user_id, v_tenant_id;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- The subtransaction is rolled back; retry reads the winning identity link.
    END;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION app_private.resolve_or_provision_identity(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.resolve_or_provision_identity(text, text, text) TO cfi_runtime, cfi_test;

RESET ROLE;
ALTER FUNCTION app_private.resolve_or_provision_identity(text, text, text) OWNER TO cfi_identity_provisioner;

SET ROLE cfi_owner;
REVOKE CREATE ON SCHEMA app_private FROM cfi_identity_provisioner;
RESET ROLE;
