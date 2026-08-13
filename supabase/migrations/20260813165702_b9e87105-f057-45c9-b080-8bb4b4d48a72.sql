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

  IF v_req.target_wallet = 'secondary' THEN
    v_credit_usd := v_req.amount;
    v_credit_result := public.credit_wallet_for_payment(
      v_req.user_id, v_credit_usd, 'secondary', v_req.id,
      CASE WHEN v_is_service THEN 'Wallet top-up auto-approved (Secondary wallet)' ELSE 'Wallet top-up approved (Secondary wallet)' END,
      v_processed_by
    );
    IF COALESCE((v_credit_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_credit_result->>'error', 'Secondary wallet credit failed');
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
    SELECT COALESCE(secondary_wallet_enabled, false) INTO v_secondary_enabled
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
    CASE WHEN v_req.target_wallet = 'secondary' THEN v_req.amount ELSE v_credit_usd END,
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

REVOKE ALL ON FUNCTION public.approve_client_topup_atomic(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_client_topup_atomic(uuid, uuid) TO authenticated, service_role;