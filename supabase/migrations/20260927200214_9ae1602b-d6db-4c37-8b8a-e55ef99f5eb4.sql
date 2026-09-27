CREATE TABLE public.site_assistant_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  assistant_name text NOT NULL DEFAULT 'Assistant',
  knowledge text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.site_assistant_settings TO authenticated;
GRANT ALL ON public.site_assistant_settings TO service_role;
ALTER TABLE public.site_assistant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage assistant settings" ON public.site_assistant_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));
INSERT INTO public.site_assistant_settings (id) VALUES (1) ON CONFLICT DO NOTHING;