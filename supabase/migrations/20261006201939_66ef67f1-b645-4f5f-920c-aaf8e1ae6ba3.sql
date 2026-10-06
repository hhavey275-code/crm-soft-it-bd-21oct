CREATE TABLE public.managed_account_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ad_account_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.managed_account_assignments TO authenticated;
GRANT ALL ON public.managed_account_assignments TO service_role;
ALTER TABLE public.managed_account_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients view own shared accounts" ON public.managed_account_assignments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Admins manage shared account assignments" ON public.managed_account_assignments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));
CREATE INDEX idx_managed_assign_user ON public.managed_account_assignments(user_id);

INSERT INTO public.managed_account_assignments (user_id, ad_account_id, assigned_at)
SELECT DISTINCT ON (user_id, ad_account_id) user_id, ad_account_id, coalesce(approved_at, created_at)
FROM public.client_facebook_pages
WHERE status = 'approved' AND ad_account_id IS NOT NULL
ON CONFLICT DO NOTHING;