
-- Restrict ad_account_rate_limits to owners + admins
DROP POLICY IF EXISTS "Authenticated users can read ad account rate limits" ON public.ad_account_rate_limits;
CREATE POLICY "Owners and admins can read ad account rate limits"
ON public.ad_account_rate_limits FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'superadmin')
  OR EXISTS (
    SELECT 1 FROM public.user_ad_accounts uaa
    WHERE uaa.ad_account_id = ad_account_rate_limits.ad_account_id
      AND uaa.user_id = auth.uid()
  )
);

-- Restrict bm_rate_limits to admins (not used in client UI)
DROP POLICY IF EXISTS "Authenticated users can read BM rate limits" ON public.bm_rate_limits;
CREATE POLICY "Admins can read BM rate limits"
ON public.bm_rate_limits FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- Restrict app_rate_limits to admins
DROP POLICY IF EXISTS "Authenticated users can read app rate limits" ON public.app_rate_limits;
CREATE POLICY "Admins can read app rate limits"
ON public.app_rate_limits FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- Restrict system_logs spend cap policy to the acting user's own rows
DROP POLICY IF EXISTS "Clients can view spend cap system_logs" ON public.system_logs;
CREATE POLICY "Clients can view own spend cap system_logs"
ON public.system_logs FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND action = ANY (ARRAY['Spend Cap Updated'::text, 'TikTok Spend Cap Updated'::text])
);
