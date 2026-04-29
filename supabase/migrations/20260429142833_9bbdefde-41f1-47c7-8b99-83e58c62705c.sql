
-- Add timestamp column to track when DSL was last synced from the Chrome extension
ALTER TABLE public.ad_account_insights
  ADD COLUMN IF NOT EXISTS daily_spend_limit_synced_at timestamptz;

ALTER TABLE public.ad_account_insights
  ADD COLUMN IF NOT EXISTS daily_spend_limit_currency text DEFAULT 'USD';

-- Ensure each ad_account_id has at most one insights row (needed for upsert from extension)
CREATE UNIQUE INDEX IF NOT EXISTS ad_account_insights_ad_account_id_uniq
  ON public.ad_account_insights(ad_account_id);
