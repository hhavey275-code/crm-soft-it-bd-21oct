CREATE OR REPLACE FUNCTION public.distribute_deposit_bdt(p_user_id uuid, p_bdt_amount numeric, p_reference_id uuid, p_processed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_main_rate numeric;
  v_sec_rate numeric;
  v_cl_rate numeric;
  v_site_rate numeric;
  v_sec_on boolean := false;
  v_cl_on boolean := false;
  v_main numeric;
  v_sec numeric;
  v_cl numeric;
  v_main_start numeric;
  v_sec_start numeric;
  v_cl_start numeric;
  v_remaining numeric := COALESCE(p_bdt_amount, 0);
  v_main_due_bdt numeric := 0;
  v_sec_due_bdt numeric := 0;
  v_cl_due_bdt numeric := 0;
  v_main_dep_bdt numeric := 0;
  v_usd numeric;
  v_ref uuid := p_reference_id;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount must be > 0');
  END IF;

  SELECT NULLIF(usd_rate, 0), NULLIF(secondary_usd_rate, 0), NULLIF(credit_line_usd_rate, 0),
         COALESCE(secondary_wallet_enabled,false), COALESCE(credit_line_wallet_enabled,false)
    INTO v_main_rate, v_sec_rate, v_cl_rate, v_sec_on, v_cl_on
  FROM public.profiles WHERE user_id = p_user_id;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';

  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_sec_rate, v_cl_rate);
  v_sec_rate  := COALESCE(v_sec_rate, v_main_rate);
  v_cl_rate   := COALESCE(v_cl_rate, v_main_rate);
  IF COALESCE(v_main_rate, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no usable usd rate');
  END IF;

  INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance, 0) INTO v_main FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance, 0) INTO v_sec FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance, 0) INTO v_cl FROM public.credit_line_wallets WHERE user_id = p_user_id FOR UPDATE;
  v_main_start := v_main;
  v_sec_start := v_sec;
  v_cl_start := v_cl;

  -- 1) Main wallet due
  IF v_main < 0 THEN
    v_main_due_bdt := LEAST(ABS(v_main) * v_main_rate, v_remaining);
    v_remaining := v_remaining - v_main_due_bdt;
    v_usd := ROUND(v_main_due_bdt / v_main_rate, 2);
    IF v_usd > 0 THEN
      v_main := v_main + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_main, v_ref,
              'Main wallet due adjustment (৳' || ROUND(v_main_due_bdt) || ' @ ৳' || v_main_rate || '/USD)',
              p_processed_by, 'primary', v_main_rate);
      v_ref := NULL;
    END IF;
  END IF;

  -- 2) Credit line wallet due (only when that wallet is enabled)
  IF v_cl_on AND v_remaining > 0 AND v_cl < 0 AND COALESCE(v_cl_rate, 0) > 0 THEN
    v_cl_due_bdt := LEAST(ABS(v_cl) * v_cl_rate, v_remaining);
    v_remaining := v_remaining - v_cl_due_bdt;
    v_usd := ROUND(v_cl_due_bdt / v_cl_rate, 2);
    IF v_usd > 0 THEN
      v_cl := v_cl + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_cl, v_ref,
              'Credit line wallet due adjustment (৳' || ROUND(v_cl_due_bdt) || ' @ ৳' || v_cl_rate || '/USD)',
              p_processed_by, 'credit_line', v_cl_rate);
      v_ref := NULL;
    END IF;
  END IF;

  -- 3) Secondary wallet due (only when that wallet is enabled)
  IF v_sec_on AND v_remaining > 0 AND v_sec < 0 AND COALESCE(v_sec_rate, 0) > 0 THEN
    v_sec_due_bdt := LEAST(ABS(v_sec) * v_sec_rate, v_remaining);
    v_remaining := v_remaining - v_sec_due_bdt;
    v_usd := ROUND(v_sec_due_bdt / v_sec_rate, 2);
    IF v_usd > 0 THEN
      v_sec := v_sec + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_sec, v_ref,
              'Secondary wallet due adjustment (৳' || ROUND(v_sec_due_bdt) || ' @ ৳' || v_sec_rate || '/USD)',
              p_processed_by, 'secondary', v_sec_rate);
      v_ref := NULL;
    END IF;
  END IF;

  -- 4) Remainder deposited to the main wallet
  IF v_remaining > 0 THEN
    v_main_dep_bdt := v_remaining;
    v_usd := ROUND(v_main_dep_bdt / v_main_rate, 2);
    v_remaining := 0;
    IF v_usd > 0 THEN
      v_main := v_main + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_main, v_ref,
              'Main wallet deposit (৳' || ROUND(v_main_dep_bdt) || ' @ ৳' || v_main_rate || '/USD)',
              p_processed_by, 'primary', v_main_rate);
      v_ref := NULL;
    END IF;
  END IF;

  IF v_main IS DISTINCT FROM v_main_start THEN
    UPDATE public.wallets SET balance = v_main, updated_at = now() WHERE user_id = p_user_id;
  END IF;
  IF v_sec IS DISTINCT FROM v_sec_start THEN
    UPDATE public.secondary_wallets SET balance = v_sec, updated_at = now() WHERE user_id = p_user_id;
  END IF;
  IF v_cl IS DISTINCT FROM v_cl_start THEN
    UPDATE public.credit_line_wallets SET balance = v_cl, updated_at = now() WHERE user_id = p_user_id;
  END IF;

  IF p_reference_id IS NOT NULL THEN
    UPDATE public.top_up_requests
       SET main_due_bdt = v_main_due_bdt,
           secondary_due_bdt = v_sec_due_bdt,
           credit_line_due_bdt = v_cl_due_bdt,
           main_deposit_bdt = v_main_dep_bdt
     WHERE id = p_reference_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'main_due_bdt', v_main_due_bdt,
    'secondary_due_bdt', v_sec_due_bdt,
    'credit_line_due_bdt', v_cl_due_bdt,
    'main_deposit_bdt', v_main_dep_bdt,
    'main_balance', v_main,
    'secondary_balance', v_sec,
    'credit_line_balance', v_cl,
    'main_rate', v_main_rate,
    'secondary_rate', v_sec_rate,
    'credit_line_rate', v_cl_rate
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.convert_main_wallet(p_target text, p_usd_amount numeric, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_user uuid := COALESCE(p_user_id, auth.uid());
  v_is_admin boolean := false;
  v_target text := lower(COALESCE(p_target, ''));
  v_main_rate numeric;
  v_tgt_rate numeric;
  v_site_rate numeric;
  v_enabled boolean := false;
  v_main numeric := 0;
  v_tgt numeric := 0;
  v_credit numeric;
  v_by text;
  v_label text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'superadmin');
  IF NOT v_is_admin AND v_actor <> v_user THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_target NOT IN ('secondary', 'credit_line') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target');
  END IF;
  IF p_usd_amount IS NULL OR p_usd_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || v_user::text, 0));

  SELECT NULLIF(usd_rate, 0),
         CASE WHEN v_target = 'secondary' THEN NULLIF(secondary_usd_rate, 0)
              ELSE NULLIF(credit_line_usd_rate, 0) END,
         CASE WHEN v_target = 'secondary' THEN COALESCE(secondary_wallet_enabled, false)
              ELSE COALESCE(credit_line_wallet_enabled, false) END
    INTO v_main_rate, v_tgt_rate, v_enabled
  FROM public.profiles WHERE user_id = v_user;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_enabled');
  END IF;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';
  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_tgt_rate, 1);
  v_tgt_rate := COALESCE(v_tgt_rate, v_main_rate);

  INSERT INTO public.wallets (user_id, balance) VALUES (v_user, 0)
  ON CONFLICT (user_id) DO NOTHING;
  IF v_target = 'secondary' THEN
    INSERT INTO public.secondary_wallets (user_id, balance) VALUES (v_user, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT COALESCE(balance, 0) INTO v_tgt FROM public.secondary_wallets WHERE user_id = v_user FOR UPDATE;
    v_label := 'Secondary';
  ELSE
    INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (v_user, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT COALESCE(balance, 0) INTO v_tgt FROM public.credit_line_wallets WHERE user_id = v_user FOR UPDATE;
    v_label := 'Credit Line';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_main FROM public.wallets WHERE user_id = v_user FOR UPDATE;
  IF v_main < p_usd_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'main_balance', v_main);
  END IF;

  v_credit := ROUND(p_usd_amount * v_main_rate / v_tgt_rate, 2);
  v_by := CASE WHEN v_is_admin AND v_actor <> v_user THEN 'admin:' || v_actor::text
               ELSE 'client:' || v_actor::text END;

  PERFORM public.adjust_wallet_atomic(v_user, -p_usd_amount, 'adjustment',
    'Moved to ' || v_label || ' wallet (rate ' || v_main_rate || ' -> ' || v_tgt_rate || ')',
    v_by, 'primary', NULL, false);

  PERFORM public.adjust_wallet_atomic(v_user, v_credit, 'adjustment',
    'Received from Main wallet (rate converted ' || v_main_rate || ' -> ' || v_tgt_rate || ')',
    v_by, v_target, NULL, true);

  RETURN jsonb_build_object('ok', true, 'moved', p_usd_amount, 'credited', v_credit,
    'target', v_target, 'main_rate', v_main_rate, 'target_rate', v_tgt_rate,
    'main_after', v_main - p_usd_amount, 'target_after', v_tgt + v_credit);
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_main_wallet(text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_main_wallet(text, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_main_wallet(text, numeric, uuid) TO service_role;