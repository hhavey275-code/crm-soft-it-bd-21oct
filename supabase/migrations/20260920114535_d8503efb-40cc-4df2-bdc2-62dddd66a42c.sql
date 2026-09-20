CREATE OR REPLACE FUNCTION public.request_external_topup(p_ad_account_id uuid, p_amount numeric, p_wallet_kind text DEFAULT 'primary'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := CASE
                   WHEN p_wallet_kind = 'secondary' THEN 'secondary'
                   WHEN p_wallet_kind = 'credit_line' THEN 'credit_line'
                   ELSE 'primary' END;
  v_acc record;
  v_url text;
  v_balance numeric := 0;
  v_due numeric := 0;
  v_req_id uuid;
  v_res jsonb;
  v_conv jsonb;
  v_last_request_at timestamptz;
  v_last_user uuid;
  v_wait_seconds int;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  -- External CRM top-ups have a hard minimum of $50.
  IF p_amount < 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'min_amount', 'min', 50);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('external-topup-queue', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || v_uid::text, 0));

  SELECT created_at, user_id INTO v_last_request_at, v_last_user
  FROM public.external_topup_requests
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_last_request_at IS NOT NULL THEN
    v_wait_seconds := 30 - GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_last_request_at)))::int);
    IF v_wait_seconds > 0 THEN
      IF v_last_user = v_uid THEN
        RETURN jsonb_build_object('ok', false, 'error', 'cooldown_active', 'scope', 'own', 'wait_seconds', v_wait_seconds);
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'cooldown_active', 'scope', 'queue', 'wait_seconds', v_wait_seconds);
      END IF;
    END IF;
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

  v_url := CASE
             WHEN v_kind = 'secondary'
               THEN COALESCE(v_acc.external_topup_url_secondary, v_acc.external_topup_url)
             WHEN v_kind = 'credit_line'
               THEN COALESCE(v_acc.external_topup_url_credit_line, v_acc.external_topup_url)
             ELSE v_acc.external_topup_url END;
  IF v_url IS NULL OR btrim(v_url) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_url_not_configured');
  END IF;

  v_due := COALESCE(public.effective_due_limit(v_uid, v_kind), 0);

  IF v_kind = 'secondary' THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (v_uid, 0)
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.secondary_wallets (user_id, balance) VALUES (v_uid, 0)
    ON CONFLICT (user_id) DO NOTHING;
    PERFORM 1 FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
    PERFORM 1 FROM public.secondary_wallets WHERE user_id = v_uid FOR UPDATE;

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
    SELECT COALESCE(balance, 0) INTO v_balance FROM public.secondary_wallets WHERE user_id = v_uid FOR UPDATE;
  ELSIF v_kind = 'credit_line' THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (v_uid, 0)
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (v_uid, 0)
    ON CONFLICT (user_id) DO NOTHING;
    PERFORM 1 FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
    PERFORM 1 FROM public.credit_line_wallets WHERE user_id = v_uid FOR UPDATE;

    v_conv := public.ensure_credit_line_funds(
      p_user_id => v_uid,
      p_needed_usd => p_amount,
      p_processed_by => 'client:' || v_uid::text,
      p_allow_negative => false,
      p_due_limit => 0
    );
    IF COALESCE((v_conv->>'ok')::boolean, false) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_conv->>'error', 'insufficient_balance'));
    END IF;
    SELECT COALESCE(balance, 0) INTO v_balance FROM public.credit_line_wallets WHERE user_id = v_uid FOR UPDATE;
  ELSE
    INSERT INTO public.wallets (user_id, balance) VALUES (v_uid, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT COALESCE(balance, 0) INTO v_balance FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
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

  v_label := CASE v_kind
               WHEN 'secondary' THEN 'Secondary wallet'
               WHEN 'credit_line' THEN 'Credit line wallet'
               ELSE 'Main wallet' END;

  v_res := public.adjust_wallet_atomic(
    p_user_id => v_uid,
    p_amount => -p_amount,
    p_type => 'external_topup_request',
    p_description => 'External CRM top-up request — ' || COALESCE(v_acc.account_name, v_acc.account_id)
                     || ' [' || v_label || ']',
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