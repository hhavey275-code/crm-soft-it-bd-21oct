-- lovable-cron-fallback-reviewed: Meta has no spend webhook; 15-min polling bounds wallet overrun before auto-pause.
CREATE TABLE public.managed_campaign_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id text NOT NULL,
  spend_date date NOT NULL,
  spend_charged numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, spend_date)
);
GRANT SELECT ON public.managed_campaign_spend TO authenticated;
GRANT ALL ON public.managed_campaign_spend TO service_role;
ALTER TABLE public.managed_campaign_spend ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner or admin view managed spend" ON public.managed_campaign_spend FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE TABLE public.managed_ads_settings (
  id int PRIMARY KEY DEFAULT 1,
  pause_threshold numeric NOT NULL DEFAULT 1,
  low_balance_alert numeric NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO public.managed_ads_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT, UPDATE ON public.managed_ads_settings TO authenticated;
GRANT ALL ON public.managed_ads_settings TO service_role;
ALTER TABLE public.managed_ads_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read managed settings" ON public.managed_ads_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins update managed settings" ON public.managed_ads_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS managed_ads_paused_at timestamptz;

CREATE OR REPLACE FUNCTION public.charge_managed_spend(p_user_id uuid, p_campaign_id text, p_date date, p_total_spend numeric, p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_charged numeric; v_delta numeric; v_res jsonb;
BEGIN
  INSERT INTO public.managed_campaign_spend (user_id, campaign_id, spend_date, spend_charged)
  VALUES (p_user_id, p_campaign_id, p_date, 0) ON CONFLICT (campaign_id, spend_date) DO NOTHING;
  SELECT spend_charged INTO v_charged FROM public.managed_campaign_spend
   WHERE campaign_id = p_campaign_id AND spend_date = p_date FOR UPDATE;
  v_delta := round(COALESCE(p_total_spend,0) - v_charged, 2);
  IF v_delta < 0.01 THEN RETURN jsonb_build_object('ok', true, 'charged', 0); END IF;
  v_res := public.adjust_wallet_atomic(p_user_id, -v_delta, 'ad_spend',
    'Ad spend — ' || COALESCE(p_label, p_campaign_id) || ' (' || p_date || ')', 'system', 'primary', NULL, true);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  UPDATE public.managed_campaign_spend SET spend_charged = spend_charged + v_delta, updated_at = now()
   WHERE campaign_id = p_campaign_id AND spend_date = p_date;
  RETURN jsonb_build_object('ok', true, 'charged', v_delta);
END $$;
REVOKE EXECUTE ON FUNCTION public.charge_managed_spend(uuid, text, date, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_managed_spend(uuid, text, date, numeric, text) TO service_role;

INSERT INTO public.internal_job_secrets (job_name, secret)
VALUES ('managed-ads-spend-sync', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (job_name) DO NOTHING;

SELECT cron.unschedule('managed-ads-spend-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'managed-ads-spend-sync');
SELECT cron.schedule('managed-ads-spend-sync', '*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://crm-plan-cholo.lovable.app/api/public/managed-ads-spend',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-job-secret', (SELECT secret FROM public.internal_job_secrets WHERE job_name = 'managed-ads-spend-sync')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);