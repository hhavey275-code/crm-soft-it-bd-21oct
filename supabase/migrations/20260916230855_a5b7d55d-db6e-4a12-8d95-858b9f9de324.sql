CREATE OR REPLACE FUNCTION public.assert_wallet_matches_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := TG_ARGV[0];
  v_ledger numeric;
  v_balance numeric;
  v_allowance numeric;
BEGIN
  -- A single database transaction can legitimately update the same wallet
  -- row more than once (e.g. Main -> Secondary conversion followed by the
  -- top-up deduction). Deferred trigger events fire once per UPDATE with
  -- the row image captured at THAT statement, while the ledger SUM below
  -- already sees every transaction row of the whole transaction. Comparing
  -- a mid-transaction NEW.balance against the final ledger falsely rejects
  -- valid top-ups. Read the row's FINAL state instead so every queued event
  -- validates the same end-of-transaction balance.
  IF v_kind = 'primary' THEN
    SELECT COALESCE(w.balance, 0), COALESCE(w.drift_allowance, 0)
      INTO v_balance, v_allowance
      FROM public.wallets w
     WHERE w.id = NEW.id;
  ELSE
    SELECT COALESCE(w.balance, 0), COALESCE(w.drift_allowance, 0)
      INTO v_balance, v_allowance
      FROM public.secondary_wallets w
     WHERE w.id = NEW.id;
  END IF;

  -- Row deleted later in the same transaction: nothing to assert.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_ledger
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND coalesce(wallet_kind,'primary') = v_kind;

  -- Accepted: exactly on the ledger, or on the ledger plus the frozen legacy allowance.
  IF abs(v_balance - v_ledger) <= 0.01
     OR abs(v_balance - v_ledger - v_allowance) <= 0.01 THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION
    'Wallet integrity check failed (% wallet, user %): balance % but transaction history says % (allowance %). Change rejected to protect money accuracy.',
    v_kind, NEW.user_id, v_balance, v_ledger, v_allowance
    USING ERRCODE = '23514';
END;
$function$;