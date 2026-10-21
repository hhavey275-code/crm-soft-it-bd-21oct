CREATE TABLE public.softcard_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id text NOT NULL UNIQUE,
  client_name text,
  amount_cents bigint NOT NULL DEFAULT 0,
  local_amount_minor bigint,
  local_currency text,
  reference text,
  source_created_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  pending_action text,
  pending_note text,
  decided_by uuid,
  decided_via text,
  callback_attempts int NOT NULL DEFAULT 0,
  last_callback_error text,
  matched_update_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.softcard_topups TO authenticated;
GRANT ALL ON public.softcard_topups TO service_role;
ALTER TABLE public.softcard_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view softcard topups" ON public.softcard_topups FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE TABLE public.softcard_callback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id text NOT NULL,
  action text NOT NULL,
  ok boolean NOT NULL,
  http_status int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.softcard_callback_log TO authenticated;
GRANT ALL ON public.softcard_callback_log TO service_role;
ALTER TABLE public.softcard_callback_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view softcard callback log" ON public.softcard_callback_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));