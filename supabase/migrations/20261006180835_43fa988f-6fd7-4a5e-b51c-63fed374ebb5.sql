CREATE TABLE public.managed_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  page_id text NOT NULL,
  ad_account_id uuid NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  campaign_id text NOT NULL UNIQUE,
  campaign_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.managed_campaigns TO authenticated;
GRANT ALL ON public.managed_campaigns TO service_role;
ALTER TABLE public.managed_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner or admin view managed campaigns" ON public.managed_campaigns FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE INDEX idx_managed_campaigns_user ON public.managed_campaigns(user_id);