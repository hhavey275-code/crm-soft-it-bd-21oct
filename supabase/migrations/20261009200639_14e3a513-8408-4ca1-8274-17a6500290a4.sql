CREATE TABLE public.kast_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text UNIQUE,
  from_email text,
  subject text,
  body text,
  otp text,
  card_last4 text,
  kind text NOT NULL DEFAULT 'other',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.kast_emails TO authenticated;
GRANT ALL ON public.kast_emails TO service_role;
ALTER TABLE public.kast_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read kast emails" ON public.kast_emails FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete kast emails" ON public.kast_emails FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
ALTER PUBLICATION supabase_realtime ADD TABLE public.kast_emails;