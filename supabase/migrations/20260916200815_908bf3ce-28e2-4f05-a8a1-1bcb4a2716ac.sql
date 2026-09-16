ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS secondary_due_limit numeric,
  ADD COLUMN IF NOT EXISTS secondary_due_limit_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS secondary_due_limit_expires_at timestamptz;

-- Effective due limit for a wallet, treating an expired limit as zero.
CREATE OR REPLACE FUNCTION public.effective_due_limit(p_user_id uuid, p_wallet_kind text DEFAULT 'primary'::text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_wallet_kind = 'secondary' THEN
      CASE WHEN p.secondary_due_limit_expires_at IS NOT NULL
                AND p.secondary_due_limit_expires_at <= now()
           THEN 0 ELSE COALESCE(p.secondary_due_limit, 0) END
    ELSE
      CASE WHEN p.due_limit_expires_at IS NOT NULL
                AND p.due_limit_expires_at <= now()
           THEN 0 ELSE COALESCE(p.due_limit, 0) END
  END
  FROM public.profiles p
  WHERE p.user_id = p_user_id
$function$;

REVOKE ALL ON FUNCTION public.effective_due_limit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_due_limit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_due_limit(uuid, text) TO service_role;

-- Secondary wallet is funded from the MAIN wallet's positive balance only.
-- Main due limit can never be spent on secondary accounts; a remaining
-- shortfall is left for the secondary wallet's own due limit to cover.
CREATE OR REPLACE FUNCTION public.ensure_secondary_funds(
  p_user_id uuid,
  p_needed_usd numeric,
  p_processed_by text DEFAULT NULL,
  p_allow_negative boolean DEFAULT false,
  p_due_limit numeric DEFAULT 0
)
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

  SELECT NULLIF(usd_rate, 0), NULLIF(secondary_usd_rate, 0)
    INTO v_main_rate, v_sec_rate
  FROM public.profiles WHERE user_id = p_user_id;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';

  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_sec_rate, 1);
  v_sec_rate  := COALESCE(v_sec_rate, v_main_rate);

  INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance, 0) INTO v_sec FROM public.secondary_wallets WHERE user_id = p_user_id;
  SELECT COALESCE(balance, 0) INTO v_main FROM public.wallets WHERE user_id = p_user_id;

  v_short := ROUND(p_needed_usd - COALESCE(v_sec, 0), 2);
  IF v_short <= 0.009 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0,
      'secondary_balance', v_sec, 'main_balance', v_main,
      'main_rate', v_main_rate, 'secondary_rate', v_sec_rate);
  END IF;

  -- how much MAIN money the shortfall would cost, capped at main's positive balance
  v_convert := ROUND(v_short * v_sec_rate / v_main_rate, 2);
  IF v_convert > GREATEST(COALESCE(v_main, 0), 0) THEN
    v_convert := ROUND(GREATEST(COALESCE(v_main, 0), 0), 2);
  END IF;

  IF v_convert <= 0.009 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0,
      'shortfall', v_short, 'secondary_balance', v_sec, 'main_balance', v_main,
      'main_rate', v_main_rate, 'secondary_rate', v_sec_rate);
  END IF;

  v_credit := ROUND(v_convert * v_main_rate / v_sec_rate, 2);
  IF v_credit > v_short THEN
    v_credit := v_short;
  END IF;

  v_by := COALESCE(p_processed_by,
    CASE WHEN v_is_admin THEN 'admin:' || v_actor::text ELSE 'client:' || v_actor::text END);

  v_res := public.adjust_wallet_atomic(
    p_user_id => p_user_id,
    p_amount => -v_convert,
    p_type => 'adjustment',
    p_description => 'Converted to Secondary wallet (rate ' || v_main_rate || ' -> ' || v_sec_rate || ')',
    p_processed_by => v_by,
    p_wallet_kind => 'primary',
    p_reference_id => NULL,
    p_allow_negative => true
  );
  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_res->>'error', 'conversion_failed'));
  END IF;

  v_res := public.adjust_wallet_atomic(
    p_user_id => p_user_id,
    p_amount => v_credit,
    p_type => 'adjustment',
    p_description => 'Received from Main wallet (rate converted ' || v_main_rate || ' -> ' || v_sec_rate || ')',
    p_processed_by => v_by,
    p_wallet_kind => 'secondary',
    p_reference_id => NULL,
    p_allow_negative => true
  );
  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    PERFORM public.adjust_wallet_atomic(
      p_user_id => p_user_id,
      p_amount => v_convert,
      p_type => 'adjustment',
      p_description => 'Reverted failed Secondary wallet conversion',
      p_processed_by => v_by,
      p_wallet_kind => 'primary',
      p_reference_id => NULL,
      p_allow_negative => true
    );
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_res->>'error', 'conversion_failed'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'converted', v_convert,
    'credited', v_credit,
    'shortfall', v_short,
    'main_rate', v_main_rate,
    'secondary_rate', v_sec_rate,
    'secondary_balance', COALESCE(v_sec, 0) + v_credit
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_external_topup(p_ad_account_id uuid, p_amount numeric, p_wallet_kind text DEFAULT 'primary'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := CASE WHEN p_wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;
  v_acc record;
  v_url text;
  v_balance numeric := 0;
  v_due numeric := 0;
  v_req_id uuid;
  v_res jsonb;
  v_conv jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  SELECT * INTO v_acc FROM public.ad_accounts WHERE id = p_ad_account_id;
  IF v_acc.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_ad_accounts
    WHERE ad_account_id = p_ad_account_id AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_assigned');
  END IF;

  IF NOT COALESCE(v_acc.external_topup_required, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_external_account');
  END IF;

  v_url := CASE WHEN v_kind = 'secondary'
                THEN COALESCE(v_acc.external_topup_url_secondary, v_acc.external_topup_url)
                ELSE v_acc.external_topup_url END;
  IF v_url IS NULL OR btrim(v_url) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_url_not_configured');
  END IF;

  -- Each wallet has its own due limit; main's limit is never usable on secondary.
  v_due := COALESCE(public.effective_due_limit(v_uid, v_kind), 0);

  IF v_kind = 'secondary' THEN
    -- Pull main wallet's positive balance (rate converted) into secondary first.
    v_conv := public.ensure_secondary_funds(
      p_user_id => v_uid,
      p_needed_usd => p_amount,
      p_processed_by => 'client:' || v_uid::text,
      p_allow_negative => false,
      p_due_limit => 0
    );
    IF COALESCE((v_conv->>'ok')::boolean, false) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_conv->>'error', 'insufficient_balance'));
    END IF;
    SELECT COALESCE(balance, 0) INTO v_balance FROM public.secondary_wallets WHERE user_id = v_uid;
  ELSE
    SELECT COALESCE(balance, 0) INTO v_balance FROM public.wallets WHERE user_id = v_uid;
  END IF;
  v_balance := COALESCE(v_balance, 0);

  IF p_amount > v_balance + v_due + 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance',
      'balance', v_balance, 'due_limit', v_due);
  END IF;

  INSERT INTO public.external_topup_requests (
    ad_account_id, user_id, amount, status, initiated_by, wallet_kind,
    requested_by_client, wallet_deducted, external_crm_name, external_topup_url
  ) VALUES (
    p_ad_account_id, v_uid, p_amount, 'pending', v_uid, v_kind,
    true, true, COALESCE(v_acc.external_crm_name, 'External CRM'), v_url
  ) RETURNING id INTO v_req_id;

  v_res := public.adjust_wallet_atomic(
    p_user_id => v_uid,
    p_amount => -p_amount,
    p_type => 'external_topup_request',
    p_description => 'External CRM top-up request — ' || COALESCE(v_acc.account_name, v_acc.account_id)
                     || ' [' || CASE WHEN v_kind = 'secondary' THEN 'Secondary wallet' ELSE 'Main wallet' END || ']',
    p_processed_by => 'client:' || v_uid::text,
    p_wallet_kind => v_kind,
    p_reference_id => v_req_id,
    p_allow_negative => true
  );

  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    DELETE FROM public.external_topup_requests WHERE id = v_req_id;
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_res->>'error', 'wallet_deduction_failed'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'request_id', v_req_id,
    'balance_after', v_res->>'balance_after', 'url', v_url,
    'converted_from_main', COALESCE(v_conv->>'converted', '0'));
END;
$function$;