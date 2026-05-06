
-- Per ad account rate limit snapshot
CREATE TABLE public.ad_account_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL UNIQUE REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  acc_util_pct numeric,
  reset_seconds int,
  access_tier text,
  buc_call_count numeric,
  buc_cputime numeric,
  buc_total_time numeric,
  estimated_regain_sec int,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_account_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ad account rate limits"
  ON public.ad_account_rate_limits FOR SELECT
  TO authenticated USING (true);

-- Per BM rate limit snapshot
CREATE TABLE public.bm_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_manager_id uuid NOT NULL UNIQUE REFERENCES public.business_managers(id) ON DELETE CASCADE,
  buc_call_count numeric,
  buc_cputime numeric,
  buc_total_time numeric,
  estimated_regain_sec int,
  business_use_case text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bm_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read BM rate limits"
  ON public.bm_rate_limits FOR SELECT
  TO authenticated USING (true);

-- Per app rate limit snapshot
CREATE TABLE public.app_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL UNIQUE,
  app_label text,
  call_count numeric,
  total_cputime numeric,
  total_time numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read app rate limits"
  ON public.app_rate_limits FOR SELECT
  TO authenticated USING (true);

CREATE INDEX idx_ad_account_rate_limits_account ON public.ad_account_rate_limits(ad_account_id);
CREATE INDEX idx_bm_rate_limits_bm ON public.bm_rate_limits(business_manager_id);
