CREATE OR REPLACE FUNCTION public.distribute_deposit_bdt(p_user_id uuid, p_bdt_amount numeric, p_reference_id uuid, p_processed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_main_rate numeric;
  v_sec_rate numeric;
  v_site_rate numeric;
  v_main numeric;
  v_sec numeric;
  v_main_start numeric;
  v_sec_start numeric;
  v_remaining numeric := COALESCE(p_bdt_amount, 0);
  v_main_due_bdt numeric := 0;
  v_sec_due_bdt numeric := 0;
  v_main_dep_bdt numeric := 0;
  v_usd numeric;
  v_ref uuid := p_reference_id;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount must be > 0');
  END IF;

  SELECT NULLIF(usd_rate, 0), NULLIF(secondary_usd_rate, 0)
    INTO v_main_rate, v_sec_rate
  FROM public.profiles WHERE user_id = p_user_id;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';

  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_sec_rate);
  v_sec_rate  := COALESCE(v_sec_rate, v_main_rate);
  IF COALESCE(v_main_rate, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no usable usd rate');
  END IF;

  INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance, 0) INTO v_main FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance, 0) INTO v_sec FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
  v_main_start := v_main;
  v_sec_start := v_sec;

  -- 1) Main wallet due (ledger row only; balance written once at the end)
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

  -- 2) Secondary wallet due, converted at the secondary rate
  IF v_remaining > 0 AND v_sec < 0 AND COALESCE(v_sec_rate, 0) > 0 THEN
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

  -- 3) Remainder deposited to the main wallet
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

  -- Single balance write per wallet keeps the deferred integrity check happy.
  IF v_main IS DISTINCT FROM v_main_start THEN
    UPDATE public.wallets SET balance = v_main, updated_at = now() WHERE user_id = p_user_id;
  END IF;
  IF v_sec IS DISTINCT FROM v_sec_start THEN
    UPDATE public.secondary_wallets SET balance = v_sec, updated_at = now() WHERE user_id = p_user_id;
  END IF;

  IF p_reference_id IS NOT NULL THEN
    UPDATE public.top_up_requests
       SET main_due_bdt = v_main_due_bdt,
           secondary_due_bdt = v_sec_due_bdt,
           main_deposit_bdt = v_main_dep_bdt
     WHERE id = p_reference_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'main_due_bdt', v_main_due_bdt,
    'secondary_due_bdt', v_sec_due_bdt,
    'main_deposit_bdt', v_main_dep_bdt,
    'main_balance', v_main,
    'secondary_balance', v_sec,
    'main_rate', v_main_rate,
    'secondary_rate', v_sec_rate
  );
END;
$function$;