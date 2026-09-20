-- 1. Per-client referral control
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_rate_bdt numeric NOT NULL DEFAULT 0;

-- 2. Per ad-account monthly referral earnings
CREATE TABLE IF NOT EXISTS public.referral_account_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referred_user_id uuid NOT NULL,
  referred_name text,
  ad_account_id uuid NOT NULL,
  account_name text,
  account_ref text,
  period_month date NOT NULL,
  spend_usd numeric NOT NULL DEFAULT 0,
  min_spend_usd numeric NOT NULL DEFAULT 3000,
  eligible boolean NOT NULL DEFAULT false,
  rate_bdt numeric NOT NULL DEFAULT 0,
  commission_bdt numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, ad_account_id, period_month)
);

GRANT SELECT ON public.referral_account_earnings TO authenticated;
GRANT ALL ON public.referral_account_earnings TO service_role;

ALTER TABLE public.referral_account_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrer reads own account earnings" ON public.referral_account_earnings;
CREATE POLICY "referrer reads own account earnings" ON public.referral_account_earnings
  FOR SELECT TO authenticated USING (referrer_id = auth.uid());

DROP POLICY IF EXISTS "admins read all account earnings" ON public.referral_account_earnings;
CREATE POLICY "admins read all account earnings" ON public.referral_account_earnings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE INDEX IF NOT EXISTS rae_referrer_month_idx
  ON public.referral_account_earnings (referrer_id, period_month);

DROP TRIGGER IF EXISTS rae_updated_at ON public.referral_account_earnings;
CREATE TRIGGER rae_updated_at BEFORE UPDATE ON public.referral_account_earnings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Payout requests in BDT
ALTER TABLE public.referral_payout_requests
  ADD COLUMN IF NOT EXISTS amount_bdt numeric NOT NULL DEFAULT 0;

ALTER TABLE public.referral_payout_requests
  ALTER COLUMN amount_usd SET DEFAULT 0;

-- 4. Available BDT balance = commission from finished months minus pending/approved payouts
CREATE OR REPLACE FUNCTION public.referral_available_bdt(p_referrer uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    COALESCE((SELECT SUM(commission_bdt) FROM public.referral_account_earnings
               WHERE referrer_id = p_referrer AND eligible
                 AND period_month < date_trunc('month', current_date)::date), 0)
    - COALESCE((SELECT SUM(amount_bdt) FROM public.referral_payout_requests
                 WHERE referrer_id = p_referrer AND status IN ('pending','approved')), 0)
  )
$$;

REVOKE ALL ON FUNCTION public.referral_available_bdt(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.referral_available_bdt(uuid) TO authenticated;

-- 5. Request payout in BDT
CREATE OR REPLACE FUNCTION public.request_referral_payout_bdt(p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_avail numeric;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT referral_enabled INTO v_enabled FROM public.profiles WHERE user_id = v_user;
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'referral_disabled');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR ROUND(p_amount, 2) <> p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  v_avail := public.referral_available_bdt(v_user);
  IF p_amount > v_avail THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'available', v_avail);
  END IF;

  INSERT INTO public.referral_payout_requests (referrer_id, amount_usd, amount_bdt, status)
  VALUES (v_user, 0, p_amount, 'pending')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'amount_bdt', p_amount);
END $$;

REVOKE ALL ON FUNCTION public.request_referral_payout_bdt(numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.request_referral_payout_bdt(numeric) TO authenticated;

-- 6. Admin review of a BDT payout (mark paid / reject; no wallet credit)
CREATE OR REPLACE FUNCTION public.review_referral_payout_bdt(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_row public.referral_payout_requests%ROWTYPE;
BEGIN
  IF v_admin IS NULL OR NOT (public.has_role(v_admin, 'admin') OR public.has_role(v_admin, 'superadmin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_row FROM public.referral_payout_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_reviewed');
  END IF;

  UPDATE public.referral_payout_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         admin_note = p_note,
         reviewed_by = v_admin,
         reviewed_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END $$;

REVOKE ALL ON FUNCTION public.review_referral_payout_bdt(uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.review_referral_payout_bdt(uuid, boolean, text) TO authenticated;

-- 7. Admin: enable/disable referral for a client and fix their taka rate
CREATE OR REPLACE FUNCTION public.set_client_referral(p_user_id uuid, p_enabled boolean, p_rate_bdt numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_code text;
BEGIN
  IF v_admin IS NULL OR NOT (public.has_role(v_admin, 'admin') OR public.has_role(v_admin, 'superadmin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_enabled AND (p_rate_bdt IS NULL OR p_rate_bdt <= 0 OR ROUND(p_rate_bdt, 2) <> p_rate_bdt) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rate');
  END IF;

  UPDATE public.profiles
     SET referral_enabled = COALESCE(p_enabled, false),
         referral_rate_bdt = CASE WHEN p_enabled THEN p_rate_bdt ELSE referral_rate_bdt END,
         referral_code = CASE WHEN p_enabled AND referral_code IS NULL THEN public.gen_referral_code() ELSE referral_code END,
         referral_code_at = CASE WHEN p_enabled AND referral_code IS NULL THEN now() ELSE referral_code_at END
   WHERE user_id = p_user_id
   RETURNING referral_code INTO v_code;

  IF v_code IS NULL AND p_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'referral_code', v_code);
END $$;

REVOKE ALL ON FUNCTION public.set_client_referral(uuid, boolean, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.set_client_referral(uuid, boolean, numeric) TO authenticated;

-- 8. Upsert the fetched monthly spend of one ad account (called by the server after reading Meta)
CREATE OR REPLACE FUNCTION public.upsert_referral_account_spend(
  p_referrer uuid,
  p_referred uuid,
  p_referred_name text,
  p_ad_account uuid,
  p_account_name text,
  p_account_ref text,
  p_month date,
  p_spend numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min numeric;
  v_rate numeric;
  v_eligible boolean;
  v_commission numeric;
  v_month date := date_trunc('month', p_month)::date;
BEGIN
  SELECT COALESCE(NULLIF(value,'')::numeric, 3000) INTO v_min
    FROM public.site_settings WHERE key = 'referral_min_monthly_spend';
  v_min := COALESCE(v_min, 3000);

  SELECT COALESCE(referral_rate_bdt, 0) INTO v_rate FROM public.profiles WHERE user_id = p_referrer;
  v_rate := COALESCE(v_rate, 0);

  v_eligible := COALESCE(p_spend, 0) >= v_min;
  v_commission := CASE WHEN v_eligible THEN ROUND(COALESCE(p_spend,0) * v_rate, 2) ELSE 0 END;

  INSERT INTO public.referral_account_earnings
    (referrer_id, referred_user_id, referred_name, ad_account_id, account_name, account_ref,
     period_month, spend_usd, min_spend_usd, eligible, rate_bdt, commission_bdt, synced_at)
  VALUES
    (p_referrer, p_referred, p_referred_name, p_ad_account, p_account_name, p_account_ref,
     v_month, ROUND(COALESCE(p_spend,0), 2), v_min, v_eligible, v_rate, v_commission, now())
  ON CONFLICT (referrer_id, ad_account_id, period_month) DO UPDATE
    SET referred_user_id = EXCLUDED.referred_user_id,
        referred_name = EXCLUDED.referred_name,
        account_name = EXCLUDED.account_name,
        account_ref = EXCLUDED.account_ref,
        spend_usd = EXCLUDED.spend_usd,
        min_spend_usd = EXCLUDED.min_spend_usd,
        eligible = EXCLUDED.eligible,
        rate_bdt = EXCLUDED.rate_bdt,
        commission_bdt = EXCLUDED.commission_bdt,
        synced_at = now(),
        updated_at = now()
    WHERE public.referral_account_earnings.status = 'pending';

  RETURN jsonb_build_object('ok', true, 'eligible', v_eligible, 'commission_bdt', v_commission);
END $$;

REVOKE ALL ON FUNCTION public.upsert_referral_account_spend(uuid, uuid, text, uuid, text, text, date, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_referral_account_spend(uuid, uuid, text, uuid, text, text, date, numeric) TO service_role;