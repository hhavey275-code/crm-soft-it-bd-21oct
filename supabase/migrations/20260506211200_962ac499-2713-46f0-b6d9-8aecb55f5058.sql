
-- Track Meta hold/disable info on each ad account so the UI can show why an account is in trouble.
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS meta_account_status integer,
  ADD COLUMN IF NOT EXISTS meta_disable_reason integer,
  ADD COLUMN IF NOT EXISTS meta_hold_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS meta_hold_reason text,
  ADD COLUMN IF NOT EXISTS meta_health_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ad_accounts_hold ON public.ad_accounts(meta_hold_detected) WHERE meta_hold_detected = true;
