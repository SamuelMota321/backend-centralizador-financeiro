ALTER TABLE public.pluggy_sync_runs
  ADD COLUMN investments_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN movements_complete BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pluggy_investments
  ADD COLUMN status VARCHAR(30),
  ADD COLUMN fixed_annual_rate NUMERIC(19,8),
  ADD COLUMN last_seen_run_id UUID;

ALTER TABLE public.pluggy_investment_movements
  ALTER COLUMN amount DROP NOT NULL,
  ADD COLUMN last_seen_run_id UUID;

CREATE INDEX pluggy_investments_seen_run_idx
  ON public.pluggy_investments (tenant_id, connection_id, last_seen_run_id);
CREATE INDEX pluggy_investment_movements_seen_run_idx
  ON public.pluggy_investment_movements (tenant_id, investment_id, last_seen_run_id);
