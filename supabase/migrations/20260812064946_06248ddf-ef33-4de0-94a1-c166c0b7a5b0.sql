CREATE OR REPLACE FUNCTION public.deduct_wallet_for_topup_v2(
  p_user_id uuid,
  p_amount numeric,
  p_ad_account_id uuid,
  p_description text,
  p_processed_by text,
  p_wallet_kind text DEFAULT 'primary',
  p_allow_negative boolean DEFAULT false,
  p_due_limit numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wallet_id uuid;
  v_balance numeric;
  v_ledger numeric;
  v_allowance numeric;
  v_expected numeric;
  v_new_balance numeric;
  v_txn_id uuid;
  v_rate numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;
  IF p_wallet_kind NOT IN ('primary','secondary') THEN
    RAISE EXCEPTION 'invalid wallet kind %', p_wallet_kind;
  END IF;

  IF p_wallet_kind = 'primary' THEN
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(usd_rate,0) INTO v_rate FROM public.profiles WHERE user_id = p_user_id;
  ELSE
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(secondary_usd_rate, usd_rate, 0) INTO v_rate
      FROM public.profiles WHERE user_id = p_user_id;
  END IF;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_ledger
    FROM public.transactions
   WHERE user_id = p_user_id
     AND COALESCE(wallet_kind,'primary') = p_wallet_kind;

  v_expected := v_ledger + v_allowance;
  IF ABS(v_balance - v_expected) > 0.01 THEN
    RAISE EXCEPTION
      'Wallet integrity mismatch before deduction (% wallet, user %): balance %, expected % (ledger %, allowance %)',
      p_wallet_kind, p_user_id, v_balance, v_expected, v_ledger, v_allowance
      USING ERRCODE = '23514';
  END IF;

  IF NOT p_allow_negative
     AND (v_balance + CASE WHEN p_wallet_kind = 'primary' THEN COALESCE(p_due_limit,0) ELSE 0 END) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance',
      'balance', v_balance, 'wallet_kind', p_wallet_kind);
  END IF;

  v_new_balance := v_balance - p_amount;

  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, reference_id, processed_by, wallet_kind, usd_rate_used)
  VALUES
    (p_user_id, -p_amount, v_new_balance, 'ad_topup', p_description, p_ad_account_id, p_processed_by, p_wallet_kind, NULLIF(v_rate,0))
  RETURNING id INTO v_txn_id;

  IF p_wallet_kind = 'primary' THEN
    UPDATE public.wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  ELSE
    UPDATE public.secondary_wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'wallet_id', v_wallet_id,
    'wallet_kind', p_wallet_kind,
    'balance_before', v_balance,
    'balance_after', v_new_balance,
    'transaction_id', v_txn_id,
    'reconciled', false,
    'usd_rate_used', v_rate
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_wallet_atomic(
  p_user_id uuid,
  p_amount numeric,
  p_type text,
  p_description text,
  p_processed_by text,
  p_wallet_kind text DEFAULT 'primary',
  p_reference_id uuid DEFAULT NULL,
  p_allow_negative boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := CASE WHEN p_wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;
  v_wallet_id uuid;
  v_balance numeric;
  v_ledger numeric;
  v_allowance numeric;
  v_expected numeric;
  v_new numeric;
  v_txn_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount required');
  END IF;

  IF v_kind = 'secondary' THEN
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.secondary_wallets (user_id, balance, drift_allowance)
      VALUES (p_user_id, 0, 0)
      RETURNING id, balance, drift_allowance INTO v_wallet_id, v_balance, v_allowance;
    END IF;
  ELSE
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, balance, drift_allowance)
      VALUES (p_user_id, 0, 0)
      RETURNING id, balance, drift_allowance INTO v_wallet_id, v_balance, v_allowance;
    END IF;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_ledger
    FROM public.transactions
   WHERE user_id = p_user_id
     AND COALESCE(wallet_kind,'primary') = v_kind;

  v_expected := v_ledger + v_allowance;
  IF ABS(v_balance - v_expected) > 0.01 THEN
    RAISE EXCEPTION
      'Wallet integrity mismatch before adjustment (% wallet, user %): balance %, expected % (ledger %, allowance %)',
      v_kind, p_user_id, v_balance, v_expected, v_ledger, v_allowance
      USING ERRCODE = '23514';
  END IF;

  v_new := v_balance + p_amount;
  IF NOT p_allow_negative AND v_new < -0.01 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'balance', v_balance);
  END IF;

  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, reference_id, processed_by, wallet_kind)
  VALUES
    (p_user_id, p_amount, v_new, p_type, p_description, p_reference_id, p_processed_by, v_kind)
  RETURNING id INTO v_txn_id;

  IF v_kind = 'secondary' THEN
    UPDATE public.secondary_wallets SET balance = v_new, updated_at = now() WHERE id = v_wallet_id;
  ELSE
    UPDATE public.wallets SET balance = v_new, updated_at = now() WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'wallet_kind', v_kind,
    'balance_before', v_balance,
    'balance_after', v_new,
    'transaction_id', v_txn_id
  );
END;
$$;

UPDATE public.wallets
SET balance = 230.77,
    drift_allowance = 230.77,
    updated_at = now()
WHERE user_id = '646d9ffb-6f7b-416d-86c7-88fa47a289a9'
  AND balance = 0
  AND drift_allowance = 0
  AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = '446a8eec-c2c3-4e78-8a9b-9d6d916cd708'
      AND user_id = '646d9ffb-6f7b-416d-86c7-88fa47a289a9'
      AND amount = 230.77
      AND type = 'top_up'
  );

INSERT INTO public.system_logs (user_id, user_name, action, details)
SELECT
  '0ea1f32a-2188-4f6e-91a2-f7e1f92e02ef'::uuid,
  'system',
  'Wallet Balance Safety Repair',
  'Boro Mama: restored approved top-up balance $230.77 after legacy-ledger reconciliation incorrectly reset the wallet to $0. Reference e1443e68-8e70-4aac-a571-8a3520cef33f.'
WHERE EXISTS (
  SELECT 1 FROM public.wallets
  WHERE user_id = '646d9ffb-6f7b-416d-86c7-88fa47a289a9'
    AND balance = 230.77
    AND drift_allowance = 230.77
);