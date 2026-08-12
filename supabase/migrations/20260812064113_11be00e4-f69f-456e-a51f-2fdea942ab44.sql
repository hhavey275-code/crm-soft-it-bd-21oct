CREATE OR REPLACE FUNCTION public.assert_wallet_matches_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := TG_ARGV[0];
  v_ledger numeric;
BEGIN
  SELECT coalesce(sum(amount),0) INTO v_ledger
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND coalesce(wallet_kind,'primary') = v_kind;

  -- Accepted: exactly on the ledger, or on the ledger plus the frozen legacy allowance.
  IF abs(coalesce(NEW.balance,0) - v_ledger) <= 0.01
     OR abs(coalesce(NEW.balance,0) - v_ledger - coalesce(NEW.drift_allowance,0)) <= 0.01 THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION
    'Wallet integrity check failed (% wallet, user %): balance % but transaction history says % (allowance %). Change rejected to protect money accuracy.',
    v_kind, NEW.user_id, NEW.balance, v_ledger, coalesce(NEW.drift_allowance,0)
    USING ERRCODE = '23514';
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
  v_new numeric;
  v_txn_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount required');
  END IF;

  IF v_kind = 'secondary' THEN
    SELECT id, coalesce(balance,0) INTO v_wallet_id, v_balance
      FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
      RETURNING id, balance INTO v_wallet_id, v_balance;
    END IF;
  ELSE
    SELECT id, coalesce(balance,0) INTO v_wallet_id, v_balance
      FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
      RETURNING id, balance INTO v_wallet_id, v_balance;
    END IF;
  END IF;

  -- Truth is the ledger, never a stale client-side read.
  SELECT coalesce(sum(amount),0) INTO v_ledger
    FROM public.transactions
   WHERE user_id = p_user_id AND coalesce(wallet_kind,'primary') = v_kind;

  IF abs(v_balance - v_ledger) > 0.01 THEN
    v_balance := v_ledger;
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
    UPDATE public.secondary_wallets
       SET balance = v_new, drift_allowance = 0, updated_at = now() WHERE id = v_wallet_id;
  ELSE
    UPDATE public.wallets
       SET balance = v_new, drift_allowance = 0, updated_at = now() WHERE id = v_wallet_id;
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

REVOKE ALL ON FUNCTION public.adjust_wallet_atomic(uuid, numeric, text, text, text, text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_wallet_atomic(uuid, numeric, text, text, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_wallet_atomic(uuid, numeric, text, text, text, text, uuid, boolean) TO service_role;