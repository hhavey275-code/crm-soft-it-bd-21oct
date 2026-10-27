-- Server-side copy of the My Ads list per user + account + dates, shared by every reload, device and
-- the AI Agent, so repeated reloads within a minute never ask Facebook again. Server (service role) only.
CREATE TABLE IF NOT EXISTS public.my_ads_list_cache (
  cache_key text PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS my_ads_list_cache_user_idx ON public.my_ads_list_cache (user_id);
CREATE INDEX IF NOT EXISTS my_ads_list_cache_account_idx ON public.my_ads_list_cache (account_id);
ALTER TABLE public.my_ads_list_cache ENABLE ROW LEVEL SECURITY;
