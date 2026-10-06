CREATE TABLE public.client_facebook_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  page_id text NOT NULL,
  page_name text NOT NULL DEFAULT '',
  page_url text,
  page_avatar_url text,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  connect_method text NOT NULL DEFAULT 'manual',
  admin_note text,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_facebook_pages TO authenticated;
GRANT ALL ON public.client_facebook_pages TO service_role;
ALTER TABLE public.client_facebook_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own pages" ON public.client_facebook_pages FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE POLICY "Clients request own pages" ON public.client_facebook_pages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending' AND ad_account_id IS NULL);
CREATE POLICY "Clients delete own pending pages" ON public.client_facebook_pages FOR DELETE TO authenticated
  USING ((user_id = auth.uid() AND status = 'pending') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE POLICY "Admins manage pages" ON public.client_facebook_pages FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE TRIGGER trg_client_fb_pages_updated BEFORE UPDATE ON public.client_facebook_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_client_fb_pages_user ON public.client_facebook_pages(user_id);
CREATE INDEX idx_client_fb_pages_account ON public.client_facebook_pages(ad_account_id);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS managed_ads_enabled boolean NOT NULL DEFAULT false;