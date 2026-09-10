CREATE TYPE "public"."identity_provider" AS ENUM ('auth0');
CREATE TYPE "public"."account_origin" AS ENUM ('manual', 'connected');
CREATE TYPE "public"."account_external_provider" AS ENUM ('pluggy');
CREATE TYPE "public"."account_type" AS ENUM ('checking', 'savings', 'payment', 'cash', 'credit_card', 'investment', 'other');

CREATE TABLE "public"."tenants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."identity_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "provider" "public"."identity_provider" NOT NULL,
  "issuer" VARCHAR(255) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "type" "public"."account_type" NOT NULL,
  "origin" "public"."account_origin" NOT NULL DEFAULT 'manual',
  "institution_name" VARCHAR(120),
  "initial_balance" DECIMAL(19,2) NOT NULL,
  "initial_balance_as_of" DATE NOT NULL,
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'BRL',
  "external_provider" "public"."account_external_provider",
  "external_account_id" VARCHAR(255),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_tenant_id_key" ON "public"."users"("tenant_id");
CREATE UNIQUE INDEX "identity_links_issuer_subject_key" ON "public"."identity_links"("issuer", "subject");
CREATE INDEX "identity_links_user_id_idx" ON "public"."identity_links"("user_id");
CREATE UNIQUE INDEX "accounts_external_identity_key" ON "public"."accounts"("tenant_id", "external_provider", "external_account_id");
CREATE INDEX "accounts_tenant_id_archived_at_idx" ON "public"."accounts"("tenant_id", "archived_at");
CREATE INDEX "accounts_tenant_id_type_idx" ON "public"."accounts"("tenant_id", "type");

ALTER TABLE "public"."users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "public"."identity_links" ADD CONSTRAINT "identity_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_name_normalized_check CHECK (
    char_length(name) BETWEEN 1 AND 100
    AND name = regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')
    AND name !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT accounts_institution_normalized_check CHECK (
    institution_name IS NULL OR (
      char_length(institution_name) BETWEEN 1 AND 120
      AND institution_name = regexp_replace(btrim(institution_name), '[[:space:]]+', ' ', 'g')
      AND institution_name !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT accounts_currency_code_check CHECK (currency_code = 'BRL'),
  ADD CONSTRAINT accounts_origin_external_check CHECK (
    (origin = 'manual' AND external_provider IS NULL AND external_account_id IS NULL)
    OR
    (origin = 'connected' AND external_provider IS NOT NULL
      AND external_account_id IS NOT NULL
      AND char_length(external_account_id) BETWEEN 1 AND 255
      AND external_account_id = btrim(external_account_id)
      AND external_account_id !~ '[[:cntrl:]]')
  );

ALTER TABLE public.identity_links
  ADD CONSTRAINT identity_links_issuer_check CHECK (
    char_length(issuer) BETWEEN 1 AND 255
    AND issuer = btrim(issuer) AND issuer !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT identity_links_subject_check CHECK (
    char_length(subject) BETWEEN 1 AND 255
    AND subject = btrim(subject) AND subject !~ '[[:cntrl:]]'
  );

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END $$;

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER identity_links_set_updated_at BEFORE UPDATE ON public.identity_links
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.assert_tenant_has_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE checked_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    checked_tenant := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    checked_tenant := OLD.tenant_id;
  ELSE
    checked_tenant := OLD.tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = checked_tenant)
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.tenant_id = checked_tenant) THEN
    RAISE EXCEPTION 'tenant must have exactly one user' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'users' AND TG_OP = 'UPDATE'
     AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id)
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'tenant must have exactly one user' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER tenants_require_user
AFTER INSERT OR UPDATE OF id ON public.tenants DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_tenant_has_user();
CREATE CONSTRAINT TRIGGER users_preserve_tenant_user
AFTER DELETE OR UPDATE OF tenant_id ON public.users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_tenant_has_user();
