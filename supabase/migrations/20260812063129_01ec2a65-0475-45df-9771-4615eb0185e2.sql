ALTER TABLE public.top_up_requests
  ADD COLUMN IF NOT EXISTS main_due_bdt numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS secondary_due_bdt numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS main_deposit_bdt numeric NOT NULL DEFAULT 0;

-- Split an approved BDT payment across: main due -> secondary due (at the
-- secondary rate) -> remainder deposited to the main wallet.
CREATE OR REPLACE FUNCTION public.distribute_deposit_bdt(
  p_user_id uuid,
  p_bdt_amount numeric,
  p_reference_id uuid,
  p_processed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_main_rate numeric;
  v_sec_rate numeric;
  v_site_rate numeric;
  v_main numeric;
  v_sec numeric;
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

  -- 1) Main wallet due
  IF v_main < 0 THEN
    v_main_due_bdt := LEAST(ABS(v_main) * v_main_rate, v_remaining);
    v_remaining := v_remaining - v_main_due_bdt;
    v_usd := ROUND(v_main_due_bdt / v_main_rate, 2);
    IF v_usd > 0 THEN
      v_main := v_main + v_usd;
      UPDATE public.wallets SET balance = v_main, updated_at = now() WHERE user_id = p_user_id;
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
      UPDATE public.secondary_wallets SET balance = v_sec, updated_at = now() WHERE user_id = p_user_id;
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
      UPDATE public.wallets SET balance = v_main, updated_at = now() WHERE user_id = p_user_id;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_main, v_ref,
              'Main wallet deposit (৳' || ROUND(v_main_dep_bdt) || ' @ ৳' || v_main_rate || '/USD)',
              p_processed_by, 'primary', v_main_rate);
      v_ref := NULL;
    END IF;
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
$$;

REVOKE ALL ON FUNCTION public.distribute_deposit_bdt(uuid, numeric, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.distribute_deposit_bdt(uuid, numeric, uuid, text) TO authenticated, service_role;

-- Admin-only manual move of main wallet balance into the secondary wallet,
-- converted between the two rates so the BDT value stays the same.
CREATE OR REPLACE FUNCTION public.admin_convert_main_to_secondary(
  p_user_id uuid,
  p_usd_amount numeric,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_main_rate numeric;
  v_sec_rate numeric;
  v_site_rate numeric;
  v_main numeric;
  v_sec numeric;
  v_credit numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'superadmin')) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  IF p_usd_amount IS NULL OR p_usd_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT NULLIF(usd_rate,0), NULLIF(secondary_usd_rate,0)
    INTO v_main_rate, v_sec_rate
  FROM public.profiles WHERE user_id = p_user_id;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';

  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_sec_rate, 1);
  v_sec_rate  := COALESCE(v_sec_rate, v_main_rate);

  INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance,0) INTO v_main FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance,0) INTO v_sec FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_main < p_usd_amount THEN
    RAISE EXCEPTION 'Main wallet balance is only $%', v_main;
  END IF;

  v_credit := ROUND(p_usd_amount * v_main_rate / v_sec_rate, 2);

  UPDATE public.wallets SET balance = v_main - p_usd_amount, updated_at = now() WHERE user_id = p_user_id;
  UPDATE public.secondary_wallets SET balance = v_sec + v_credit, updated_at = now() WHERE user_id = p_user_id;

  INSERT INTO public.transactions
    (user_id, type, amount, balance_after, description, processed_by, wallet_kind, usd_rate_used)
  VALUES (p_user_id, 'adjustment', -p_usd_amount, v_main - p_usd_amount,
          'Moved to Secondary wallet (rate ' || v_main_rate || ' -> ' || v_sec_rate || ')'
            || COALESCE(': ' || p_reason, ''),
          'admin:' || v_actor::text, 'primary', v_main_rate);

  INSERT INTO public.transactions
    (user_id, type, amount, balance_after, description, processed_by, wallet_kind, usd_rate_used)
  VALUES (p_user_id, 'adjustment', v_credit, v_sec + v_credit,
          'Received from Main wallet (rate converted)' || COALESCE(': ' || p_reason, ''),
          'admin:' || v_actor::text, 'secondary', v_sec_rate);

  INSERT INTO public.system_logs (user_id, user_name, action, details)
  VALUES (v_actor,
          COALESCE((SELECT full_name FROM public.profiles WHERE user_id = v_actor),
                   (SELECT email FROM public.profiles WHERE user_id = v_actor), 'admin'),
          'Main → Secondary Wallet Conversion',
          'User ' || p_user_id::text || ': $' || p_usd_amount || ' @ ৳' || v_main_rate
            || ' → $' || v_credit || ' @ ৳' || v_sec_rate || COALESCE('. Reason: ' || p_reason, ''));

  RETURN jsonb_build_object('ok', true, 'moved', p_usd_amount, 'credited', v_credit,
    'main_after', v_main - p_usd_amount, 'secondary_after', v_sec + v_credit);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_convert_main_to_secondary(uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_convert_main_to_secondary(uuid, numeric, text) TO authenticated, service_role;

-- Automatic main -> secondary settlement is disabled; conversion is manual now.
CREATE OR REPLACE FUNCTION public.settle_secondary_from_main(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN jsonb_build_object('moved', 0, 'reason', 'auto_settlement_disabled');
END;
$$;