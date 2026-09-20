CREATE TYPE public.transaction_type AS ENUM ('income', 'expense', 'transfer');
CREATE TYPE public.transaction_status AS ENUM ('posted', 'voided');
CREATE TYPE public.transfer_side AS ENUM ('outgoing', 'incoming');
CREATE TYPE public.categorization_status AS ENUM (
  'unclassified',
  'categorized',
  'uncertain',
  'unrecognized',
  'not_applicable'
);
CREATE TYPE public.categorization_source AS ENUM ('manual', 'rule');
CREATE TYPE public.category_source AS ENUM ('user');
CREATE TYPE public.category_status AS ENUM ('active', 'archived');
CREATE TYPE public.category_rule_status AS ENUM ('active', 'inactive', 'removed');
CREATE TYPE public.category_rule_condition_field AS ENUM ('description', 'type', 'account_id');
CREATE TYPE public.category_rule_operator AS ENUM (
  'equals',
  'contains',
  'starts_with',
  'ends_with'
);

CREATE TABLE public.categories (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  source public.category_source NOT NULL DEFAULT 'user',
  status public.category_status NOT NULL DEFAULT 'active',
  archived_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT categories_status_check CHECK (
    (status = 'active' AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  )
);

CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  account_id UUID NOT NULL,
  type public.transaction_type NOT NULL,
  amount NUMERIC(19, 2) NOT NULL,
  occurred_on DATE NOT NULL,
  description TEXT,
  status public.transaction_status NOT NULL DEFAULT 'posted',
  transfer_id UUID,
  transfer_side public.transfer_side,
  category_id UUID,
  categorization_status public.categorization_status NOT NULL DEFAULT 'unclassified',
  categorization_source public.categorization_source,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transactions_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transactions_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.categories(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT transactions_amount_positive_check CHECK (amount > 0),
  CONSTRAINT transactions_transfer_shape_check CHECK (
    (type = 'transfer' AND transfer_id IS NOT NULL AND transfer_side IS NOT NULL)
    OR
    (type IN ('income', 'expense') AND transfer_id IS NULL AND transfer_side IS NULL)
  ),
  CONSTRAINT transactions_categorization_shape_check CHECK (
    (
      type = 'transfer'
      AND category_id IS NULL
      AND categorization_status = 'not_applicable'
      AND categorization_source IS NULL
    )
    OR
    (
      type IN ('income', 'expense')
      AND (
        (
          category_id IS NULL
          AND categorization_status IN ('unclassified', 'uncertain', 'unrecognized')
          AND categorization_source IS NULL
        )
        OR
        (
          category_id IS NOT NULL
          AND categorization_status = 'categorized'
          AND categorization_source IS NOT NULL
        )
      )
    )
  )
);

CREATE TABLE public.category_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  category_id UUID NOT NULL,
  condition_field public.category_rule_condition_field NOT NULL,
  condition_operator public.category_rule_operator NOT NULL,
  condition_value TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status public.category_rule_status NOT NULL DEFAULT 'active',
  removed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT category_rules_pkey PRIMARY KEY (id),
  CONSTRAINT category_rules_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT category_rules_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.categories(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT category_rules_condition_check CHECK (
    btrim(condition_value) <> ''
    AND (condition_field = 'description' OR condition_operator = 'equals')
  ),
  CONSTRAINT category_rules_priority_check CHECK (priority >= 0),
  CONSTRAINT category_rules_status_check CHECK (
    (status = 'removed' AND removed_at IS NOT NULL)
    OR (status IN ('active', 'inactive') AND removed_at IS NULL)
  )
);

CREATE UNIQUE INDEX categories_tenant_name_key
  ON public.categories (tenant_id, name);
CREATE INDEX categories_tenant_status_name_idx
  ON public.categories (tenant_id, status, name);
CREATE INDEX transactions_tenant_occurred_on_id_idx
  ON public.transactions (tenant_id, occurred_on, id);
CREATE INDEX transactions_tenant_account_occurred_on_id_idx
  ON public.transactions (tenant_id, account_id, occurred_on, id);
CREATE INDEX transactions_tenant_transfer_id_idx
  ON public.transactions (tenant_id, transfer_id);
CREATE INDEX transactions_tenant_category_id_idx
  ON public.transactions (tenant_id, category_id);
CREATE UNIQUE INDEX transactions_tenant_transfer_side_key
  ON public.transactions (tenant_id, transfer_id, transfer_side)
  WHERE transfer_id IS NOT NULL;
CREATE INDEX category_rules_tenant_status_priority_created_at_id_idx
  ON public.category_rules (tenant_id, status, priority, created_at, id);
CREATE INDEX category_rules_tenant_category_status_idx
  ON public.category_rules (tenant_id, category_id, status);

ALTER TYPE public.transaction_type OWNER TO cfi_owner;
ALTER TYPE public.transaction_status OWNER TO cfi_owner;
ALTER TYPE public.transfer_side OWNER TO cfi_owner;
ALTER TYPE public.categorization_status OWNER TO cfi_owner;
ALTER TYPE public.categorization_source OWNER TO cfi_owner;
ALTER TYPE public.category_source OWNER TO cfi_owner;
ALTER TYPE public.category_status OWNER TO cfi_owner;
ALTER TYPE public.category_rule_status OWNER TO cfi_owner;
ALTER TYPE public.category_rule_condition_field OWNER TO cfi_owner;
ALTER TYPE public.category_rule_operator OWNER TO cfi_owner;
ALTER TABLE public.categories OWNER TO cfi_owner;
ALTER TABLE public.transactions OWNER TO cfi_owner;
ALTER TABLE public.category_rules OWNER TO cfi_owner;

SET ROLE cfi_owner;

REVOKE ALL ON public.categories, public.transactions, public.category_rules FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.categories, public.transactions, public.category_rules TO cfi_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories, public.transactions, public.category_rules TO cfi_test;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY categories_select_own ON public.categories
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY categories_insert_own ON public.categories
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY categories_update_own ON public.categories
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY categories_delete_test ON public.categories
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY transactions_select_own ON public.transactions
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY transactions_insert_own ON public.transactions
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY transactions_update_own ON public.transactions
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY transactions_delete_test ON public.transactions
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY category_rules_select_own ON public.category_rules
  FOR SELECT TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id());
CREATE POLICY category_rules_insert_own ON public.category_rules
  FOR INSERT TO cfi_runtime, cfi_test
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY category_rules_update_own ON public.category_rules
  FOR UPDATE TO cfi_runtime, cfi_test
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
CREATE POLICY category_rules_delete_test ON public.category_rules
  FOR DELETE TO cfi_test
  USING (tenant_id = app_private.current_tenant_id());

RESET ROLE;

