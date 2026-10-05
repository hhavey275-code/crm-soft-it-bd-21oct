CREATE OR REPLACE FUNCTION public.superadmin_remove_transaction(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tx public.transactions%ROWTYPE;
  v_kind text;
BEGIN
  IF lower(coalesce(auth.jwt()->>'email','')) <> 'maksudurrahaman64@gmail.com'
     OR NOT public.has_role(auth.uid(), 'superadmin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not allowed');
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;
  v_kind := coalesce(v_tx.wallet_kind, 'primary');

  DELETE FROM public.transactions WHERE id = p_id;

  -- Keep wallet balance equal to its transaction history.
  IF v_kind = 'primary' THEN
    UPDATE public.wallets SET balance = coalesce(balance,0) - v_tx.amount WHERE user_id = v_tx.user_id;
  ELSIF v_kind = 'secondary' THEN
    UPDATE public.secondary_wallets SET balance = coalesce(balance,0) - v_tx.amount WHERE user_id = v_tx.user_id;
  ELSIF v_kind = 'credit_line' THEN
    UPDATE public.credit_line_wallets SET balance = coalesce(balance,0) - v_tx.amount WHERE user_id = v_tx.user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'amount', v_tx.amount, 'wallet_kind', v_kind);
END; $$;

REVOKE ALL ON FUNCTION public.superadmin_remove_transaction(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_remove_transaction(uuid) TO authenticated, service_role;