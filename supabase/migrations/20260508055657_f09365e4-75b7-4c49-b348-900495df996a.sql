ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS client_topup_disabled boolean NOT NULL DEFAULT false;