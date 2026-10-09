ALTER TABLE public.kast_emails
  ADD COLUMN IF NOT EXISTS used_at timestamptz,
  ADD COLUMN IF NOT EXISTS used_by uuid,
  ADD COLUMN IF NOT EXISTS used_by_name text,
  ADD COLUMN IF NOT EXISTS used_device text;

GRANT UPDATE ON public.kast_emails TO authenticated;

CREATE POLICY "Admins mark kast email used" ON public.kast_emails
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

ALTER TABLE public.kast_emails REPLICA IDENTITY FULL;