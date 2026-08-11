
-- Atomic refund for a failed top-up: ledger row + wallet balance + clear record
CREATE OR REPLACE FUNCTION public.refund_failed_topup(p_failed_topup_id uuid, p_processed_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ft record;
  v_kind text;
  v_wallet_id uuid;
  v_bal numeric := 0;
  v_new numeric;
  v_desc text;
  v_acc record;
BEGIN
  SELECT * INTO v_ft FROM public.failed_topups WHERE id = p_failed_topup_id AND status = 'pending' FOR UPDATE;
  IF v_ft IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Failed top-up not found or already resolved');
  END IF;

  v_kind := CASE WHEN v_ft.wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;

  SELECT account_name, account_id INTO v_acc FROM public.ad_accounts WHERE id = v_ft.ad_account_id;

  IF v_kind = 'secondary' THEN
    SELECT id, COALESCE(balance,0) INTO v_wallet_id, v_bal FROM public.secondary_wallets WHERE user_id = v_ft.user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.secondary_wallets (user_id, balance) VALUES (v_ft.user_id, 0) RETURNING id INTO v_wallet_id;
      v_bal := 0;
    END IF;
  ELSE
    SELECT id, COALESCE(balance,0) INTO v_wallet_id, v_bal FROM public.wallets WHERE user_id = v_ft.user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, balance) VALUES (v_ft.user_id, 0) RETURNING id INTO v_wallet_id;
      v_bal := 0;
    END IF;
  END IF;

  v_new := v_bal + v_ft.amount;
  v_desc := 'Refund: Failed top-up' ||
            COALESCE(E'\n' || v_acc.account_name, '') ||
            COALESCE(E'\n' || regexp_replace(COALESCE(v_acc.account_id,''), '^act_', ''), '');

  INSERT INTO public.transactions (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind)
  VALUES (v_ft.user_id, 'refund', v_ft.amount, v_new, v_ft.ad_account_id, v_desc, p_processed_by, v_kind);

  IF v_kind = 'secondary' THEN
    UPDATE public.secondary_wallets SET balance = v_new WHERE id = v_wallet_id;
  ELSE
    UPDATE public.wallets SET balance = v_new WHERE id = v_wallet_id;
  END IF;

  DELETE FROM public.failed_topups WHERE id = p_failed_topup_id;

  RETURN jsonb_build_object('success', true, 'refunded_amount', v_ft.amount, 'wallet_kind', v_kind, 'new_balance', v_new);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_failed_topup(uuid, text) TO service_role;

-- Repair: credit an approved top-up request whose wallet credit never landed
CREATE OR REPLACE FUNCTION public.credit_missing_approved_topup(p_request_id uuid, p_processed_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req record;
  v_kind text;
BEGIN
  SELECT * INTO v_req FROM public.top_up_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;
  IF v_req.status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request is not approved');
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE type = 'top_up' AND reference_id = p_request_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already credited');
  END IF;

  v_kind := CASE WHEN v_req.target_wallet = 'secondary' THEN 'secondary' ELSE 'primary' END;

  RETURN public.credit_wallet_for_payment(
    v_req.user_id,
    v_req.amount,
    v_kind,
    p_request_id,
    'Wallet top-up approved (credit repaired)',
    p_processed_by
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_missing_approved_topup(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_missing_approved_topup(uuid, text) TO service_role;
