CREATE OR REPLACE FUNCTION public.credit_wallet_for_payment(p_user_id uuid, p_amount numeric, p_wallet_kind text, p_reference_id uuid, p_description text, p_processed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := CASE
    WHEN p_wallet_kind = 'secondary' THEN 'secondary'
    WHEN p_wallet_kind = 'credit_line' THEN 'credit_line'
    ELSE 'primary' END;
  v_wallet_id uuid;
  v_ledger_total numeric := 0;
  v_new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount must be positive');
  END IF;

  IF v_kind = 'secondary' THEN
    SELECT id INTO v_wallet_id FROM public.secondary_wallets WHERE user_id = p_user_id;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
      RETURNING id INTO v_wallet_id;
    END IF;
    SELECT COALESCE(balance, 0) INTO v_ledger_total FROM public.secondary_wallets WHERE id = v_wallet_id;
  ELSIF v_kind = 'credit_line' THEN
    SELECT id INTO v_wallet_id FROM public.credit_line_wallets WHERE user_id = p_user_id;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (p_user_id, 0)
      RETURNING id INTO v_wallet_id;
    END IF;
    SELECT COALESCE(balance, 0) INTO v_ledger_total FROM public.credit_line_wallets WHERE id = v_wallet_id;
  ELSE
    SELECT id, COALESCE(balance, 0) INTO v_wallet_id, v_ledger_total
    FROM public.wallets WHERE user_id = p_user_id;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
      RETURNING id INTO v_wallet_id;
      v_ledger_total := 0;
    END IF;
  END IF;

  v_new_balance := v_ledger_total + p_amount;

  INSERT INTO public.transactions (
    user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind
  ) VALUES (
    p_user_id, 'top_up', p_amount, v_new_balance, p_reference_id, p_description, p_processed_by, v_kind
  );

  IF v_kind = 'secondary' THEN
    UPDATE public.secondary_wallets SET balance = v_new_balance WHERE id = v_wallet_id;
  ELSIF v_kind = 'credit_line' THEN
    UPDATE public.credit_line_wallets SET balance = v_new_balance WHERE id = v_wallet_id;
  ELSE
    UPDATE public.wallets SET balance = v_new_balance WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'wallet_kind', v_kind,
    'amount', p_amount,
    'new_balance', v_new_balance
  );
END;
$function$;

-- Repair: approved credit-line top-ups that were wrongly credited to the main wallet
DO $repair$
DECLARE
  r record;
  v_new numeric;
BEGIN
  FOR r IN
    SELECT t.id, t.user_id, t.amount
    FROM public.transactions t
    JOIN public.top_up_requests q ON q.id = t.reference_id
    WHERE t.type = 'top_up'
      AND t.wallet_kind = 'primary'
      AND q.target_wallet = 'credit_line'
      AND q.status = 'approved'
  LOOP
    INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (r.user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.wallets SET balance = COALESCE(balance,0) - r.amount WHERE user_id = r.user_id;
    UPDATE public.credit_line_wallets SET balance = COALESCE(balance,0) + r.amount
    WHERE user_id = r.user_id
    RETURNING balance INTO v_new;

    UPDATE public.transactions
    SET wallet_kind = 'credit_line', balance_after = v_new
    WHERE id = r.id;
  END LOOP;
END
$repair$;