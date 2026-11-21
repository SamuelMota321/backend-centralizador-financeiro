\set ON_ERROR_STOP on

BEGIN;
SELECT set_config('app.current_tenant_id', '11111111-1111-4111-8111-111111111111', true);
INSERT INTO public.tenants (id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.users (id, tenant_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.connections (id, tenant_id, owner_user_id, provider, provider_item_id, status, consent_status, consent_products)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pluggy', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'connected', 'granted', ARRAY['ACCOUNTS']);
INSERT INTO public.pluggy_sync_runs (id, tenant_id, connection_id, owner_user_id, trigger)
VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'manual');
INSERT INTO public.pluggy_account_snapshots (tenant_id, connection_id, provider_account_id, name, type, balance, currency_code, reference_date)
VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', 'Conta sintética', 'BANK', 100, 'BRL', CURRENT_TIMESTAMP);
INSERT INTO public.pluggy_investments (id, tenant_id, connection_id, provider_id, name, type, balance)
VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'provider-investment-1', 'Ativo sintético', 'ETF', 118.4);
INSERT INTO public.pluggy_investment_movements (tenant_id, connection_id, investment_id, provider_id, type, amount, occurred_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '44444444-4444-4444-8444-444444444444', 'provider-movement-1', 'BUY', 118.4, CURRENT_TIMESTAMP);
INSERT INTO public.pluggy_account_snapshots (tenant_id, connection_id, provider_account_id, name, type, balance, currency_code, reference_date)
VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', 'Conta sintética', 'BANK', 120, 'BRL', CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, connection_id, provider_account_id) DO UPDATE SET balance = EXCLUDED.balance;
INSERT INTO public.pluggy_investments (tenant_id, connection_id, provider_id, name, type, balance)
VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'provider-investment-1', 'Ativo sintético', 'ETF', 120)
ON CONFLICT (tenant_id, connection_id, provider_id) DO UPDATE SET balance = EXCLUDED.balance;
INSERT INTO public.pluggy_investment_movements (tenant_id, connection_id, investment_id, provider_id, type, amount, occurred_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '44444444-4444-4444-8444-444444444444', 'provider-movement-1', 'BUY', 120, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, connection_id, investment_id, provider_id) DO UPDATE SET amount = EXCLUDED.amount;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.pluggy_account_snapshots) <> 1
     OR (SELECT count(*) FROM public.pluggy_investments) <> 1
     OR (SELECT count(*) FROM public.pluggy_investment_movements) <> 1 THEN
    RAISE EXCEPTION 'Provider replay duplicated persisted data';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.pluggy_sync_runs (tenant_id, connection_id, owner_user_id, trigger)
    VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'manual');
    RAISE EXCEPTION 'Active connection overlap was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

UPDATE public.pluggy_sync_runs
SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP,
    retention_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days'
WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

INSERT INTO public.pluggy_sync_runs (tenant_id, connection_id, owner_user_id, trigger, civil_date)
VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'daily', '2026-11-21');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.pluggy_sync_runs (tenant_id, connection_id, owner_user_id, trigger, civil_date)
    VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'daily', '2026-11-21');
    RAISE EXCEPTION 'Daily replay was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM app_private.list_daily_pluggy_sync_targets()) <> 1 THEN
    RAISE EXCEPTION 'Daily target enumeration failed';
  END IF;
  IF (SELECT app_private.prune_expired_pluggy_sync_runs()) <> 0 THEN
    RAISE EXCEPTION 'Unexpired run was deleted';
  END IF;
END $$;

UPDATE public.pluggy_sync_runs
SET retention_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
DO $$
BEGIN
  IF (SELECT app_private.prune_expired_pluggy_sync_runs()) <> 1 THEN
    RAISE EXCEPTION 'Expired terminal run was not deleted';
  END IF;
END $$;

SELECT set_config('app.current_tenant_id', '22222222-2222-4222-8222-222222222222', true);
INSERT INTO public.tenants (id) VALUES ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.users (id, tenant_id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.pluggy_sync_runs) <> 0 THEN
    RAISE EXCEPTION 'Tenant B could read tenant A sync runs';
  END IF;
  IF (SELECT count(*) FROM public.pluggy_account_snapshots) <> 0
     OR (SELECT count(*) FROM public.pluggy_investments) <> 0
     OR (SELECT count(*) FROM public.pluggy_investment_movements) <> 0 THEN
    RAISE EXCEPTION 'Tenant B could read tenant A provider data';
  END IF;
  IF (SELECT count(*) FROM app_private.list_daily_pluggy_sync_targets()) <> 1 THEN
    RAISE EXCEPTION 'Daily target enumeration lost tenant A';
  END IF;
END $$;
ROLLBACK;
