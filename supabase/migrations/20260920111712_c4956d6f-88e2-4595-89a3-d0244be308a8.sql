
-- 1) allow credit_line as a deposit target
ALTER TABLE public.top_up_requests DROP CONSTRAINT IF EXISTS top_up_requests_target_wallet_check;
ALTER TABLE public.top_up_requests
  ADD CONSTRAINT top_up_requests_target_wallet_check
  CHECK (target_wallet IN ('primary','secondary','credit_line'));

-- 2) approval: credit the chosen wallet at that wallet's own rate
CREATE OR REPLACE FUNCTION public.approve_client_topup_atomic(p_request_id uuid, p_admin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_is_admin boolean := false;
  v_is_seller_approver boolean := false;
  v_processed_by text;
  v_req public.top_up_requests%ROWTYPE;
  v_existing_id uuid;
  v_secondary_enabled boolean := false;
  v_target_enabled boolean := false;
  v_target_rate numeric := 0;
  v_target_label text;
  v_card_bill public.card_bills%ROWTYPE;
  v_total_bdt numeric := 0;
  v_rate numeric := 0;
  v_main_balance numeric := 0;
  v_wallet_due_paid_bdt numeric := 0;
  v_sheet_bill_bdt numeric := 0;
  v_credit_bdt numeric := 0;
  v_credit_usd numeric := 0;
  v_credit_result jsonb;
  v_invoice_number text;
BEGIN
  SELECT * INTO v_req
  FROM public.top_up_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Top-up request not found';
  END IF;

  IF NOT v_is_service THEN
    IF v_actor IS NULL OR p_admin IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'Invalid approval identity';
    END IF;

    v_is_admin := public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'superadmin');

    SELECT EXISTS (
      SELECT 1
      FROM public.bank_accounts b
      JOIN public.profiles p ON p.user_id = v_actor
      WHERE b.id = v_req.bank_account_id
        AND b.seller_id = v_actor
        AND COALESCE(p.can_approve_topups, false) = true
    ) INTO v_is_seller_approver;

    IF NOT (v_is_admin OR v_is_seller_approver) THEN
      RAISE EXCEPTION 'Not authorized to approve this top-up';
    END IF;
  END IF;

  v_processed_by := CASE
    WHEN v_is_service THEN 'system'
    WHEN v_is_seller_approver AND NOT v_is_admin THEN 'seller:' || v_actor::text
    ELSE 'admin:' || v_actor::text
  END;

  IF v_req.status = 'approved' THEN
    IF EXISTS (
      SELECT 1 FROM public.transactions
      WHERE reference_id = p_request_id AND type = 'top_up'
    ) OR COALESCE(v_req.sheet_bill_bdt, 0) >= COALESCE(v_req.bdt_amount, 0) THEN
      RETURN jsonb_build_object('success', true, 'already_approved', true);
    END IF;
    RAISE EXCEPTION 'Request is approved but wallet credit is missing; use Missing Wallet Credits to repair it';
  END IF;

  IF v_req.status NOT IN ('pending', 'hold') THEN
    RAISE EXCEPTION 'This request has already been processed';
  END IF;

  IF NULLIF(BTRIM(COALESCE(v_req.payment_reference, '')), '') IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.top_up_requests
    WHERE payment_reference = v_req.payment_reference
      AND status = 'approved'
      AND id <> v_req.id
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'This payment reference is already used by another approved request';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE reference_id = p_request_id AND type = 'top_up'
  ) THEN
    RAISE EXCEPTION 'This request has already been credited';
  END IF;

  v_total_bdt := COALESCE(v_req.bdt_amount, 0);
  v_rate := COALESCE(NULLIF(v_req.usd_rate, 0), CASE WHEN v_req.amount > 0 AND v_total_bdt > 0 THEN v_total_bdt / v_req.amount ELSE 0 END);

  IF v_req.target_wallet IN ('secondary', 'credit_line') THEN
    -- strict: the target wallet must actually be enabled for this client
    SELECT CASE WHEN v_req.target_wallet = 'secondary'
                THEN COALESCE(secondary_wallet_enabled, false)
                ELSE COALESCE(credit_line_wallet_enabled, false) END,
           CASE WHEN v_req.target_wallet = 'secondary'
                THEN NULLIF(secondary_usd_rate, 0)
                ELSE NULLIF(credit_line_usd_rate, 0) END
      INTO v_target_enabled, v_target_rate
    FROM public.profiles WHERE user_id = v_req.user_id;

    IF NOT COALESCE(v_target_enabled, false) THEN
      RAISE EXCEPTION 'Target wallet is not enabled for this client';
    END IF;

    v_target_rate := COALESCE(v_target_rate, NULLIF(v_rate, 0));
    IF COALESCE(v_target_rate, 0) <= 0 THEN
      RAISE EXCEPTION 'No usable USD rate for the selected wallet';
    END IF;

    v_credit_usd := CASE
      WHEN v_total_bdt > 0 THEN ROUND(v_total_bdt / v_target_rate, 2)
      ELSE ROUND(COALESCE(v_req.amount, 0), 2)
    END;

    IF v_credit_usd <= 0 THEN
      RAISE EXCEPTION 'Credit amount must be greater than zero';
    END IF;

    v_target_label := CASE WHEN v_req.target_wallet = 'secondary' THEN 'Secondary wallet' ELSE 'Credit line wallet' END;

    v_credit_result := public.credit_wallet_for_payment(
      v_req.user_id, v_credit_usd, v_req.target_wallet, v_req.id,
      'Wallet top-up ' || CASE WHEN v_is_service THEN 'auto-approved' ELSE 'approved' END
        || ' (' || v_target_label || ' @ ' || v_target_rate || '/USD)',
      v_processed_by
    );
    IF COALESCE((v_credit_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_credit_result->>'error', v_target_label || ' credit failed');
    END IF;
  ELSE
    SELECT * INTO v_card_bill
    FROM public.card_bills
    WHERE user_id = v_req.user_id AND status = 'pending' AND due_amount_bdt > 0
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_total_bdt > 0 AND v_rate > 0 THEN
      SELECT COALESCE(balance, 0) INTO v_main_balance
      FROM public.wallets WHERE user_id = v_req.user_id;

      IF v_main_balance < 0 THEN
        v_wallet_due_paid_bdt := LEAST(ABS(v_main_balance) * v_rate, v_total_bdt);
      END IF;

      v_sheet_bill_bdt := LEAST(
        v_card_bill.due_amount_bdt,
        GREATEST(v_total_bdt - v_wallet_due_paid_bdt, 0)
      );

      UPDATE public.card_bills
      SET due_amount_bdt = due_amount_bdt - v_sheet_bill_bdt,
          status = CASE WHEN due_amount_bdt - v_sheet_bill_bdt <= 0 THEN 'paid' ELSE 'pending' END,
          updated_at = now()
      WHERE id = v_card_bill.id;
    END IF;

    v_credit_bdt := GREATEST(v_total_bdt - v_sheet_bill_bdt, 0);
    SELECT COALESCE(secondary_wallet_enabled, false) OR COALESCE(credit_line_wallet_enabled, false)
      INTO v_secondary_enabled
    FROM public.profiles WHERE user_id = v_req.user_id;

    IF v_secondary_enabled AND v_credit_bdt > 0 THEN
      v_credit_result := public.distribute_deposit_bdt(
        v_req.user_id, v_credit_bdt, v_req.id, v_processed_by
      );
      IF COALESCE((v_credit_result->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION '%', COALESCE(v_credit_result->>'error', 'Wallet distribution failed');
      END IF;
      v_credit_usd := CASE WHEN v_rate > 0 THEN ROUND(v_credit_bdt / v_rate, 2) ELSE v_req.amount END;
    ELSIF v_credit_bdt > 0 OR v_total_bdt <= 0 THEN
      v_credit_usd := CASE
        WHEN v_total_bdt > 0 AND v_rate > 0 THEN ROUND(v_credit_bdt / v_rate, 2)
        ELSE v_req.amount
      END;
      IF v_credit_usd > 0 THEN
        v_credit_result := public.credit_wallet_for_payment(
          v_req.user_id, v_credit_usd, 'primary', v_req.id,
          CASE WHEN v_is_service THEN 'Wallet top-up auto-approved' ELSE 'Wallet top-up approved' END,
          v_processed_by
        );
        IF COALESCE((v_credit_result->>'success')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION '%', COALESCE(v_credit_result->>'error', 'Main wallet credit failed');
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.top_up_requests
  SET status = 'approved',
      reviewed_by = CASE WHEN v_is_service THEN NULL ELSE v_actor END,
      sheet_bill_bdt = v_sheet_bill_bdt,
      wallet_due_paid_bdt = v_wallet_due_paid_bdt,
      updated_at = now()
  WHERE id = v_req.id;

  v_invoice_number := public.generate_invoice_number();
  INSERT INTO public.invoices (
    top_up_request_id, invoice_number, user_id, amount, bdt_amount, usd_rate
  ) VALUES (
    v_req.id, v_invoice_number, v_req.user_id,
    v_credit_usd,
    v_req.bdt_amount, v_req.usd_rate
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'already_approved', false,
    'credited_usd', v_credit_usd,
    'sheet_bill_bdt', v_sheet_bill_bdt,
    'wallet_due_paid_bdt', v_wallet_due_paid_bdt,
    'credit', v_credit_result
  );
END;
$function$;

-- 3) client-side conversion: stricter rate/amount rules
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
  v_amount numeric;
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
  v_amount := ROUND(p_usd_amount, 2);
  IF v_amount <> p_usd_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_must_have_max_2_decimals');
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
  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_tgt_rate);
  v_tgt_rate := COALESCE(v_tgt_rate, v_main_rate);

  IF COALESCE(v_main_rate, 0) <= 0 OR COALESCE(v_tgt_rate, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_usable_usd_rate');
  END IF;

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
  IF v_main < v_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'main_balance', v_main);
  END IF;

  v_credit := ROUND(v_amount * v_main_rate / v_tgt_rate, 2);
  IF v_credit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'converted_amount_too_small');
  END IF;

  v_by := CASE WHEN v_is_admin AND v_actor <> v_user THEN 'admin:' || v_actor::text
               ELSE 'client:' || v_actor::text END;

  PERFORM public.adjust_wallet_atomic(v_user, -v_amount, 'adjustment',
    'Moved to ' || v_label || ' wallet (৳' || ROUND(v_amount * v_main_rate, 2) || ' @ ' || v_main_rate || ' -> ' || v_tgt_rate || ')',
    v_by, 'primary', NULL, false);

  PERFORM public.adjust_wallet_atomic(v_user, v_credit, 'adjustment',
    'Received from Main wallet (৳' || ROUND(v_amount * v_main_rate, 2) || ' @ ' || v_main_rate || ' -> ' || v_tgt_rate || ')',
    v_by, v_target, NULL, true);

  RETURN jsonb_build_object('ok', true, 'moved', v_amount, 'credited', v_credit,
    'bdt_value', ROUND(v_amount * v_main_rate, 2),
    'target', v_target, 'main_rate', v_main_rate, 'target_rate', v_tgt_rate,
    'main_after', v_main - v_amount, 'target_after', v_tgt + v_credit);
END;
$function$;
