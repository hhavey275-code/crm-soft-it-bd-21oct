CREATE TABLE IF NOT EXISTS public.client_user_tokens (
  user_id uuid PRIMARY KEY,
  fb_user_id text,
  access_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_user_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_user_tokens FROM anon, authenticated;
GRANT ALL ON public.client_user_tokens TO service_role;