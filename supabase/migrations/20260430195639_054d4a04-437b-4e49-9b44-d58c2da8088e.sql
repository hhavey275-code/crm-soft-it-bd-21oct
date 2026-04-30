-- Add billing-page-derived fields to ad_account_insights for SMIT-style live data
ALTER TABLE public.ad_account_insights
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS timezone_name text,
  ADD COLUMN IF NOT EXISTS total_spending numeric,
  ADD COLUMN IF NOT EXISTS outstanding_balance numeric,
  ADD COLUMN IF NOT EXISTS billing_raw_snapshot jsonb;

ALTER TABLE public.ad_account_last_known_state
  ADD COLUMN IF NOT EXISTS hidden_daily_limit numeric,
  ADD COLUMN IF NOT EXISTS billing_threshold numeric,
  ADD COLUMN IF NOT EXISTS total_spending numeric,
  ADD COLUMN IF NOT EXISTS outstanding_balance numeric,
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS timezone_name text,
  ADD COLUMN IF NOT EXISTS billing_raw_snapshot jsonb;