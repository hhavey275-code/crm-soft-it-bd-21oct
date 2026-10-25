CREATE OR REPLACE FUNCTION public.convert_between_wallets(p_source text, p_target text, p_usd_amount numeric, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_user uuid := COALESCE(p_user_id, auth.uid());
  v_is_admin boolean := false;
  v_src text := lower(COALESCE(p_source, ''));
  v_tgt text := lower(COALESCE(p_target, ''));
  v_amount numeric;
  v_p public.profiles%ROWTYPE;
  v_site_rate numeric;
  v_main_rate numeric;
  v_src_rate numeric;
  v_tgt_rate numeric;
  v_src_bal numeric := 0;
  v_tgt_bal numeric := 0;
  v_credit numeric;
  v_bdt numeric;
  v_by text;
  v_src_label text;
  v_tgt_label text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'superadmin');
  IF NOT v_is_admin AND v_actor <> v_user THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_src NOT IN ('primary','secondary','credit_line') OR v_tgt NOT IN ('primary','secondary','credit_line') OR v_src = v_tgt THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_wallets');
  END IF;
  IF p_usd_amount IS NULL OR p_usd_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  v_amount := ROUND(p_usd_amount, 2);
  IF v_amount <> p_usd_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_two_decimals');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || v_user::text, 0));

  SELECT * INTO v_p FROM public.profiles WHERE user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  IF (v_src = 'secondary' OR v_tgt = 'secondary') AND NOT COALESCE(v_p.secondary_wallet_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_enabled');
  END IF;
  IF (v_src = 'credit_line' OR v_tgt = 'credit_line') AND NOT COALESCE(v_p.credit_line_wallet_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_enabled');
  END IF;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate FROM public.site_settings WHERE key = 'usd_rate';
  v_main_rate := COALESCE(NULLIF(v_p.usd_rate, 0), v_site_rate, NULLIF(v_p.secondary_usd_rate, 0), NULLIF(v_p.credit_line_usd_rate, 0));
  v_src_rate := CASE v_src WHEN 'primary' THEN v_main_rate
                 WHEN 'secondary' THEN COALESCE(NULLIF(v_p.secondary_usd_rate, 0), v_main_rate)
                 ELSE COALESCE(NULLIF(v_p.credit_line_usd_rate, 0), v_main_rate) END;
  v_tgt_rate := CASE v_tgt WHEN 'primary' THEN v_main_rate
                 WHEN 'secondary' THEN COALESCE(NULLIF(v_p.secondary_usd_rate, 0), v_main_rate)
                 ELSE COALESCE(NULLIF(v_p.credit_line_usd_rate, 0), v_main_rate) END;
  IF COALESCE(v_src_rate, 0) <= 0 OR COALESCE(v_tgt_rate, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_usable_usd_rate');
  END IF;

  INSERT INTO public.wallets (user_id, balance) VALUES (v_user, 0) ON CONFLICT (user_id) DO NOTHING;
  IF v_src = 'secondary' OR v_tgt = 'secondary' THEN
    INSERT INTO public.secondary_wallets (user_id, balance) VALUES (v_user, 0) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  IF v_src = 'credit_line' OR v_tgt = 'credit_line' THEN
    INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (v_user, 0) ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF v_src = 'primary' THEN SELECT COALESCE(balance,0) INTO v_src_bal FROM public.wallets WHERE user_id = v_user FOR UPDATE;
  ELSIF v_src = 'secondary' THEN SELECT COALESCE(balance,0) INTO v_src_bal FROM public.secondary_wallets WHERE user_id = v_user FOR UPDATE;
  ELSE SELECT COALESCE(balance,0) INTO v_src_bal FROM public.credit_line_wallets WHERE user_id = v_user FOR UPDATE; END IF;
  IF v_tgt = 'primary' THEN SELECT COALESCE(balance,0) INTO v_tgt_bal FROM public.wallets WHERE user_id = v_user FOR UPDATE;
  ELSIF v_tgt = 'secondary' THEN SELECT COALESCE(balance,0) INTO v_tgt_bal FROM public.secondary_wallets WHERE user_id = v_user FOR UPDATE;
  ELSE SELECT COALESCE(balance,0) INTO v_tgt_bal FROM public.credit_line_wallets WHERE user_id = v_user FOR UPDATE; END IF;

  IF v_src_bal < v_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'source_balance', v_src_bal);
  END IF;

  v_credit := ROUND(v_amount * v_src_rate / v_tgt_rate, 2);
  IF v_credit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'converted_amount_too_small');
  END IF;
  v_bdt := ROUND(v_amount * v_src_rate, 2);

  v_src_label := CASE v_src WHEN 'primary' THEN 'Main' WHEN 'secondary' THEN 'Secondary' ELSE 'Credit Line' END;
  v_tgt_label := CASE v_tgt WHEN 'primary' THEN 'Main' WHEN 'secondary' THEN 'Secondary' ELSE 'Credit Line' END;
  v_by := CASE WHEN v_is_admin AND v_actor <> v_user THEN 'admin:' || v_actor::text ELSE 'client:' || v_actor::text END;

  PERFORM public.adjust_wallet_atomic(v_user, -v_amount, 'adjustment',
    'Moved to ' || v_tgt_label || ' wallet (৳' || v_bdt || ' @ ' || v_src_rate || ' -> ' || v_tgt_rate || ')',
    v_by, v_src, NULL, false);
  PERFORM public.adjust_wallet_atomic(v_user, v_credit, 'adjustment',
    'Received from ' || v_src_label || ' wallet (৳' || v_bdt || ' @ ' || v_src_rate || ' -> ' || v_tgt_rate || ')',
    v_by, v_tgt, NULL, true);

  RETURN jsonb_build_object('ok', true, 'moved', v_amount, 'credited', v_credit, 'bdt_value', v_bdt,
    'source', v_src, 'target', v_tgt, 'source_rate', v_src_rate, 'target_rate', v_tgt_rate,
    'source_after', v_src_bal - v_amount, 'target_after', v_tgt_bal + v_credit);
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_between_wallets(text, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_between_wallets(text, text, numeric, uuid) TO authenticated;