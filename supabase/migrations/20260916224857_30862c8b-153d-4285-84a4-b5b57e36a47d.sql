CREATE OR REPLACE FUNCTION public.ensure_secondary_funds(p_user_id uuid, p_needed_usd numeric, p_processed_by text DEFAULT NULL::text, p_allow_negative boolean DEFAULT false, p_due_limit numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_main_rate numeric;
  v_sec_rate numeric;
  v_site_rate numeric;
  v_main numeric := 0;
  v_sec numeric := 0;
  v_short numeric;
  v_convert numeric;
  v_credit numeric;
  v_by text;
  v_res jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'superadmin');
  IF NOT v_is_admin AND v_actor <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_needed_usd IS NULL OR p_needed_usd <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user_id::text, 0));

  SELECT NULLIF(usd_rate, 0), NULLIF(secondary_usd_rate, 0)
    INTO v_main_rate, v_sec_rate
  FROM public.profiles WHERE user_id = p_user_id;
  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';
  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_sec_rate, 1);
  v_sec_rate := COALESCE(v_sec_rate, v_main_rate);

  INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance, 0) INTO v_main
    FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance, 0) INTO v_sec
    FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;

  v_short := ROUND(p_needed_usd - COALESCE(v_sec, 0), 2);
  IF v_short <= 0.009 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0,
      'secondary_balance', v_sec, 'main_balance', v_main,
      'main_rate', v_main_rate, 'secondary_rate', v_sec_rate);
  END IF;

  v_convert := ROUND(v_short * v_sec_rate / v_main_rate, 2);
  IF v_convert > GREATEST(COALESCE(v_main, 0), 0) THEN
    v_convert := ROUND(GREATEST(COALESCE(v_main, 0), 0), 2);
  END IF;
  IF v_convert <= 0.009 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0,
      'shortfall', v_short, 'secondary_balance', v_sec, 'main_balance', v_main,
      'main_rate', v_main_rate, 'secondary_rate', v_sec_rate);
  END IF;

  v_credit := LEAST(ROUND(v_convert * v_main_rate / v_sec_rate, 2), v_short);
  v_by := COALESCE(p_processed_by,
    CASE WHEN v_is_admin THEN 'admin:' || v_actor::text ELSE 'client:' || v_actor::text END);

  v_res := public.adjust_wallet_atomic(p_user_id, -v_convert, 'adjustment',
    'Converted to Secondary wallet (rate ' || v_main_rate || ' -> ' || v_sec_rate || ')',
    v_by, 'primary', NULL, true);
  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_res->>'error', 'conversion_failed'));
  END IF;

  v_res := public.adjust_wallet_atomic(p_user_id, v_credit, 'adjustment',
    'Received from Main wallet (rate converted ' || v_main_rate || ' -> ' || v_sec_rate || ')',
    v_by, 'secondary', NULL, true);
  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    RAISE EXCEPTION 'Secondary wallet conversion credit failed: %', COALESCE(v_res->>'error', 'conversion_failed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'converted', v_convert, 'credited', v_credit,
    'shortfall', v_short, 'main_rate', v_main_rate, 'secondary_rate', v_sec_rate,
    'secondary_balance', COALESCE(v_sec, 0) + v_credit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.deduct_wallet_for_topup_v2(p_user_id uuid, p_amount numeric, p_ad_account_id uuid, p_description text, p_processed_by text, p_wallet_kind text DEFAULT 'primary'::text, p_allow_negative boolean DEFAULT false, p_due_limit numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet_id uuid;
  v_balance numeric;
  v_ledger numeric;
  v_allowance numeric;
  v_expected numeric;
  v_new_balance numeric;
  v_txn_id uuid;
  v_rate numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_wallet_kind NOT IN ('primary','secondary') THEN RAISE EXCEPTION 'invalid wallet kind %', p_wallet_kind; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user_id::text, 0));

  IF p_wallet_kind = 'primary' THEN
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(usd_rate,0) INTO v_rate FROM public.profiles WHERE user_id = p_user_id;
  ELSE
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(secondary_usd_rate, usd_rate, 0) INTO v_rate
      FROM public.profiles WHERE user_id = p_user_id;
  END IF;

  IF v_wallet_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found'); END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_ledger
    FROM public.transactions
   WHERE user_id = p_user_id AND COALESCE(wallet_kind,'primary') = p_wallet_kind;
  v_expected := v_ledger + v_allowance;
  IF ABS(v_balance - v_expected) > 0.01 THEN
    RAISE EXCEPTION 'Wallet integrity mismatch before deduction (% wallet, user %): balance %, expected % (ledger %, allowance %)',
      p_wallet_kind, p_user_id, v_balance, v_expected, v_ledger, v_allowance USING ERRCODE = '23514';
  END IF;

  IF NOT p_allow_negative AND (v_balance + COALESCE(p_due_limit,0)) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'balance', v_balance, 'wallet_kind', p_wallet_kind);
  END IF;

  v_new_balance := v_balance - p_amount;
  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, reference_id, processed_by, wallet_kind, usd_rate_used)
  VALUES
    (p_user_id, -p_amount, v_new_balance, 'ad_topup', p_description, p_ad_account_id, p_processed_by, p_wallet_kind, NULLIF(v_rate,0))
  RETURNING id INTO v_txn_id;

  IF p_wallet_kind = 'primary' THEN
    UPDATE public.wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  ELSE
    UPDATE public.secondary_wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'wallet_id', v_wallet_id, 'wallet_kind', p_wallet_kind,
    'balance_before', v_balance, 'balance_after', v_new_balance, 'transaction_id', v_txn_id,
    'reconciled', false, 'usd_rate_used', v_rate);
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_internal_topup_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_ad_account_id uuid,
  p_description text,
  p_processed_by text,
  p_wallet_kind text DEFAULT 'primary',
  p_allow_negative boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_kind text := CASE WHEN p_wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;
  v_due numeric := 0;
  v_conversion jsonb := '{}'::jsonb;
  v_deduction jsonb;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  v_is_admin := public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'superadmin');
  IF NOT v_is_admin AND v_actor <> p_user_id THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  IF p_allow_negative AND NOT v_is_admin THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user_id::text, 0));
  IF NOT p_allow_negative THEN
    v_due := COALESCE(public.effective_due_limit(p_user_id, v_kind), 0);
  END IF;

  IF v_kind = 'secondary' THEN
    v_conversion := public.ensure_secondary_funds(p_user_id, p_amount, p_processed_by, p_allow_negative, 0);
    IF NOT COALESCE((v_conversion->>'ok')::boolean, false) THEN RETURN v_conversion; END IF;
  END IF;

  v_deduction := public.deduct_wallet_for_topup_v2(
    p_user_id, p_amount, p_ad_account_id, p_description, p_processed_by,
    v_kind, p_allow_negative, v_due
  );
  IF NOT COALESCE((v_deduction->>'ok')::boolean, false) THEN
    RAISE EXCEPTION USING MESSAGE = 'wallet_topup_rejected:' || COALESCE(v_deduction->>'error', 'deduction_failed'), ERRCODE = 'P0001';
  END IF;

  RETURN v_deduction || jsonb_build_object('converted_from_main', COALESCE(v_conversion->>'converted','0'));
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_secondary_funds(uuid, numeric, text, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_secondary_funds(uuid, numeric, text, boolean, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.deduct_wallet_for_topup_v2(uuid, numeric, uuid, text, text, text, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_wallet_for_topup_v2(uuid, numeric, uuid, text, text, text, boolean, numeric) TO service_role;
REVOKE ALL ON FUNCTION public.process_internal_topup_wallet(uuid, numeric, uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_internal_topup_wallet(uuid, numeric, uuid, text, text, text, boolean) TO authenticated, service_role;