DROP POLICY IF EXISTS "Admins read kast emails" ON public.kast_emails;
DROP POLICY IF EXISTS "Admins delete kast emails" ON public.kast_emails;
CREATE POLICY "Admins read kast emails" ON public.kast_emails FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Admins delete kast emails" ON public.kast_emails FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));