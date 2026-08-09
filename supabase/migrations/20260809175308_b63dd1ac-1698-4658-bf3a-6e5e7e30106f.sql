CREATE OR REPLACE FUNCTION public.deduct_wallet_for_topup(
  p_user_id uuid,
  p_amount numeric,
  p_ad_account_id uuid,
  p_description text,
  p_processed_by text,
  p_allow_negative boolean DEFAULT false,
  p_due_limit numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id uuid;
  v_balance numeric;
  v_ledger numeric;
  v_reconciled boolean := false;
  v_new_balance numeric;
  v_txn_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  SELECT id, COALESCE(balance,0) INTO v_wallet_id, v_balance
  FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_ledger
  FROM public.transactions WHERE user_id = p_user_id;

  -- Keep wallet balance consistent with its transaction ledger so a
  -- deduction can never make the recorded balance jump upwards.
  IF ABS(v_balance - v_ledger) > 0.01 THEN
    v_reconciled := true;
    v_balance := v_ledger;
    UPDATE public.wallets SET balance = v_ledger, updated_at = now() WHERE id = v_wallet_id;
  END IF;

  IF NOT p_allow_negative AND (v_balance + COALESCE(p_due_limit,0)) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'balance', v_balance, 'reconciled', v_reconciled);
  END IF;

  v_new_balance := v_balance - p_amount;

  UPDATE public.wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;

  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, reference_id, processed_by)
  VALUES
    (p_user_id, -p_amount, v_new_balance, 'ad_topup', p_description, p_ad_account_id, p_processed_by)
  RETURNING id INTO v_txn_id;

  RETURN jsonb_build_object(
    'ok', true,
    'wallet_id', v_wallet_id,
    'balance_before', v_balance,
    'balance_after', v_new_balance,
    'transaction_id', v_txn_id,
    'reconciled', v_reconciled
  );
END $$;

GRANT EXECUTE ON FUNCTION public.deduct_wallet_for_topup(uuid, numeric, uuid, text, text, boolean, numeric) TO service_role;