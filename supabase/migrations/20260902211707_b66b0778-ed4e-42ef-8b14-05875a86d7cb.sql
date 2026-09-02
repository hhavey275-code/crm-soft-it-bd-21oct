-- 1. profiles columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid,
  ADD COLUMN IF NOT EXISTS referral_rate_usd numeric,
  ADD COLUMN IF NOT EXISTS referral_code_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key ON public.profiles (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON public.profiles (referred_by);

-- code generator
CREATE OR REPLACE FUNCTION public.gen_referral_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  i int;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_code);
  END LOOP;
  RETURN v_code;
END $$;

-- backfill codes for everyone
UPDATE public.profiles
   SET referral_code = public.gen_referral_code(),
       referral_code_at = now()
 WHERE referral_code IS NULL;

-- auto code on new profile
CREATE OR REPLACE FUNCTION public.set_referral_code_on_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.gen_referral_code();
    NEW.referral_code_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_referral_code_on_profile_trg ON public.profiles;
CREATE TRIGGER set_referral_code_on_profile_trg
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_referral_code_on_profile();

-- 2. earnings table
CREATE TABLE IF NOT EXISTS public.referral_monthly_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referred_user_id uuid NOT NULL,
  referred_name text,
  period_month date NOT NULL,
  spend_usd numeric NOT NULL DEFAULT 0,
  eligible boolean NOT NULL DEFAULT false,
  min_spend_usd numeric NOT NULL DEFAULT 3000,
  rate_used numeric NOT NULL DEFAULT 0,
  commission_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, referred_user_id, period_month)
);

GRANT SELECT ON public.referral_monthly_earnings TO authenticated;
GRANT ALL ON public.referral_monthly_earnings TO service_role;
ALTER TABLE public.referral_monthly_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrer reads own earnings" ON public.referral_monthly_earnings;
CREATE POLICY "referrer reads own earnings" ON public.referral_monthly_earnings
FOR SELECT TO authenticated USING (referrer_id = auth.uid());

DROP POLICY IF EXISTS "admins read all earnings" ON public.referral_monthly_earnings;
CREATE POLICY "admins read all earnings" ON public.referral_monthly_earnings
FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE INDEX IF NOT EXISTS rme_referrer_month_idx ON public.referral_monthly_earnings (referrer_id, period_month);

DROP TRIGGER IF EXISTS rme_updated_at ON public.referral_monthly_earnings;
CREATE TRIGGER rme_updated_at BEFORE UPDATE ON public.referral_monthly_earnings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. payout requests
CREATE TABLE IF NOT EXISTS public.referral_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  amount_usd numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  wallet_txn_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.referral_payout_requests TO authenticated;
GRANT ALL ON public.referral_payout_requests TO service_role;
ALTER TABLE public.referral_payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrer reads own payouts" ON public.referral_payout_requests;
CREATE POLICY "referrer reads own payouts" ON public.referral_payout_requests
FOR SELECT TO authenticated USING (referrer_id = auth.uid());

DROP POLICY IF EXISTS "admins read all payouts" ON public.referral_payout_requests;
CREATE POLICY "admins read all payouts" ON public.referral_payout_requests
FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

DROP TRIGGER IF EXISTS rpr_updated_at ON public.referral_payout_requests;
CREATE TRIGGER rpr_updated_at BEFORE UPDATE ON public.referral_payout_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. settings
INSERT INTO public.site_settings (key, value) VALUES
  ('referral_default_rate','0.10'),
  ('referral_min_monthly_spend','3000'),
  ('referral_enabled','on')
ON CONFLICT (key) DO NOTHING;

-- 5. attach referral at signup
CREATE OR REPLACE FUNCTION public.attach_referral(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_referrer uuid;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no code');
  END IF;

  SELECT referred_by INTO v_existing FROM public.profiles WHERE user_id = v_uid;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_referred');
  END IF;

  SELECT user_id INTO v_referrer FROM public.profiles
   WHERE upper(referral_code) = upper(trim(p_code));
  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF v_referrer = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_referral');
  END IF;

  UPDATE public.profiles SET referred_by = v_referrer, updated_at = now() WHERE user_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer);
END $$;

REVOKE ALL ON FUNCTION public.attach_referral(text) FROM public;
GRANT EXECUTE ON FUNCTION public.attach_referral(text) TO authenticated;

-- 6. recalc earnings for a month
CREATE OR REPLACE FUNCTION public.recalc_referral_earnings(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date := date_trunc('month', COALESCE(p_month, current_date))::date;
  v_next date := (v_month + interval '1 month')::date;
  v_default_rate numeric;
  v_min numeric;
  v_rows int := 0;
  r record;
  v_rate numeric;
  v_commission numeric;
  v_eligible boolean;
BEGIN
  SELECT COALESCE(NULLIF(value,'')::numeric, 0.10) INTO v_default_rate
    FROM public.site_settings WHERE key = 'referral_default_rate';
  v_default_rate := COALESCE(v_default_rate, 0.10);
  SELECT COALESCE(NULLIF(value,'')::numeric, 3000) INTO v_min
    FROM public.site_settings WHERE key = 'referral_min_monthly_spend';
  v_min := COALESCE(v_min, 3000);

  FOR r IN
    SELECT p.user_id AS referred_user_id,
           p.referred_by AS referrer_id,
           COALESCE(p.full_name, p.email) AS referred_name,
           COALESCE((SELECT SUM(s.total_spend) FROM public.client_daily_stats s
                      WHERE s.user_id = p.user_id
                        AND s.stat_date >= v_month AND s.stat_date < v_next), 0) AS spend
    FROM public.profiles p
    WHERE p.referred_by IS NOT NULL
  LOOP
    SELECT COALESCE(referral_rate_usd, v_default_rate) INTO v_rate
      FROM public.profiles WHERE user_id = r.referrer_id;
    v_rate := COALESCE(v_rate, v_default_rate);
    v_eligible := r.spend >= v_min;
    v_commission := CASE WHEN v_eligible THEN ROUND(r.spend * v_rate, 2) ELSE 0 END;

    INSERT INTO public.referral_monthly_earnings
      (referrer_id, referred_user_id, referred_name, period_month,
       spend_usd, eligible, min_spend_usd, rate_used, commission_usd, status)
    VALUES
      (r.referrer_id, r.referred_user_id, r.referred_name, v_month,
       ROUND(r.spend,2), v_eligible, v_min, v_rate, v_commission, 'pending')
    ON CONFLICT (referrer_id, referred_user_id, period_month) DO UPDATE
      SET referred_name = EXCLUDED.referred_name,
          spend_usd = EXCLUDED.spend_usd,
          eligible = EXCLUDED.eligible,
          min_spend_usd = EXCLUDED.min_spend_usd,
          rate_used = EXCLUDED.rate_used,
          commission_usd = EXCLUDED.commission_usd,
          updated_at = now()
      WHERE public.referral_monthly_earnings.status = 'pending';

    v_rows := v_rows + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'month', v_month, 'rows', v_rows,
                            'default_rate', v_default_rate, 'min_spend', v_min);
END $$;

REVOKE ALL ON FUNCTION public.recalc_referral_earnings(date) FROM public;
GRANT EXECUTE ON FUNCTION public.recalc_referral_earnings(date) TO authenticated;

-- 7. referral summary (available balance)
CREATE OR REPLACE FUNCTION public.referral_available_balance(p_referrer uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    COALESCE((SELECT SUM(commission_usd) FROM public.referral_monthly_earnings
               WHERE referrer_id = p_referrer AND eligible
                 AND period_month < date_trunc('month', current_date)::date), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM public.referral_payout_requests
                 WHERE referrer_id = p_referrer AND status IN ('pending','approved')), 0)
  )
$$;

REVOKE ALL ON FUNCTION public.referral_available_balance(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.referral_available_balance(uuid) TO authenticated;

-- 8. request payout
CREATE OR REPLACE FUNCTION public.request_referral_payout(p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_available numeric;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF COALESCE((SELECT value FROM public.site_settings WHERE key='referral_enabled'),'on') <> 'on' THEN
    RAISE EXCEPTION 'Referral program is currently disabled';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  v_available := public.referral_available_balance(v_uid);
  IF p_amount > v_available + 0.001 THEN
    RAISE EXCEPTION 'Requested $% but only $% is available', p_amount, v_available;
  END IF;

  INSERT INTO public.referral_payout_requests (referrer_id, amount_usd)
  VALUES (v_uid, ROUND(p_amount,2))
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT ur.user_id, 'New referral payout request',
         COALESCE((SELECT full_name FROM public.profiles WHERE user_id = v_uid), 'A client')
           || ' requested $' || ROUND(p_amount,2) || ' referral commission.',
         'info'
  FROM public.user_roles ur
  WHERE ur.role IN ('admin','superadmin');

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'amount', ROUND(p_amount,2));
END $$;

REVOKE ALL ON FUNCTION public.request_referral_payout(numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.request_referral_payout(numeric) TO authenticated;

-- 9. approve / reject payout
CREATE OR REPLACE FUNCTION public.review_referral_payout(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_req public.referral_payout_requests;
  v_res jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'superadmin')) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  SELECT * INTO v_req FROM public.referral_payout_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Request already %', v_req.status; END IF;

  IF NOT p_approve THEN
    UPDATE public.referral_payout_requests
       SET status='rejected', admin_note=p_note, reviewed_by=v_actor, reviewed_at=now(), updated_at=now()
     WHERE id = p_id;
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (v_req.referrer_id, 'Referral payout rejected',
            'Your $' || v_req.amount_usd || ' referral payout request was rejected.'
              || COALESCE(' Note: ' || p_note, ''), 'warning');
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  v_res := public.adjust_wallet_atomic(
    v_req.referrer_id, v_req.amount_usd, 'top_up',
    'Referral commission payout' || COALESCE(' — ' || p_note, ''),
    'admin:' || v_actor::text, 'primary', v_req.id, false
  );
  IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_res->>'error', 'wallet credit failed');
  END IF;

  UPDATE public.referral_payout_requests
     SET status='approved', admin_note=p_note, reviewed_by=v_actor, reviewed_at=now(),
         wallet_txn_id = (v_res->>'transaction_id')::uuid, updated_at=now()
   WHERE id = p_id;

  UPDATE public.referral_monthly_earnings
     SET status='paid', locked_at=now(), updated_at=now()
   WHERE referrer_id = v_req.referrer_id
     AND status='pending' AND eligible
     AND period_month < date_trunc('month', current_date)::date;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (v_req.referrer_id, 'Referral payout approved',
          '$' || v_req.amount_usd || ' referral commission has been added to your wallet.', 'success');

  INSERT INTO public.system_logs (user_id, user_name, action, details)
  VALUES (v_actor,
          COALESCE((SELECT full_name FROM public.profiles WHERE user_id=v_actor), 'admin'),
          'Referral Payout Approved',
          'Referrer ' || v_req.referrer_id::text || ': $' || v_req.amount_usd
            || COALESCE('. Note: ' || p_note, ''));

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'wallet', v_res);
END $$;

REVOKE ALL ON FUNCTION public.review_referral_payout(uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.review_referral_payout(uuid, boolean, text) TO authenticated;