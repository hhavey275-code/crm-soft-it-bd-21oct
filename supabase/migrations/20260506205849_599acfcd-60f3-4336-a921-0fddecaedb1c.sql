-- 1. Call log table
CREATE TABLE IF NOT EXISTS public.ad_account_call_log (
  id bigserial PRIMARY KEY,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  account_id text,
  called_at timestamptz NOT NULL DEFAULT now(),
  endpoint text,
  status_code int,
  error_code int,
  error_subcode int,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_call_log_acc_time
  ON public.ad_account_call_log(ad_account_id, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_log_time
  ON public.ad_account_call_log(called_at DESC);

ALTER TABLE public.ad_account_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read call log"
  ON public.ad_account_call_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- 2. Extend rate limits table
ALTER TABLE public.ad_account_rate_limits
  ADD COLUMN IF NOT EXISTS access_tier text,
  ADD COLUMN IF NOT EXISTS active_ads_count int,
  ADD COLUMN IF NOT EXISTS estimated_call_limit int;
