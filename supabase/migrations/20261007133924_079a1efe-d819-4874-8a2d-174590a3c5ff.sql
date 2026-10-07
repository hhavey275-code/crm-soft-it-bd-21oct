CREATE TABLE public.client_page_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  page_id text NOT NULL,
  access_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_id)
);
GRANT ALL ON public.client_page_tokens TO service_role;
ALTER TABLE public.client_page_tokens ENABLE ROW LEVEL SECURITY;