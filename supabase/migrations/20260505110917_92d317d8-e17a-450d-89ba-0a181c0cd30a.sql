CREATE TABLE public.ad_account_sync_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id UUID NOT NULL REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ad_account_sync_requests_pending_uniq
  ON public.ad_account_sync_requests (ad_account_id)
  WHERE status = 'pending';

CREATE INDEX ad_account_sync_requests_status_idx
  ON public.ad_account_sync_requests (status, requested_at);

ALTER TABLE public.ad_account_sync_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all sync requests"
  ON public.ad_account_sync_requests
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Owners view sync requests for their accounts"
  ON public.ad_account_sync_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ad_accounts a
      WHERE a.id = ad_account_sync_requests.ad_account_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners create sync requests for their accounts"
  ON public.ad_account_sync_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ad_accounts a
      WHERE a.id = ad_account_sync_requests.ad_account_id
        AND a.user_id = auth.uid()
    )
  );

CREATE TRIGGER update_ad_account_sync_requests_updated_at
  BEFORE UPDATE ON public.ad_account_sync_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();