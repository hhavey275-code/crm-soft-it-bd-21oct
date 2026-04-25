ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS pull_api_key text;