ALTER TABLE public.top_up_requests
  ADD COLUMN IF NOT EXISTS target_wallet text NOT NULL DEFAULT 'primary';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'top_up_requests_target_wallet_check'
  ) THEN
    ALTER TABLE public.top_up_requests
      ADD CONSTRAINT top_up_requests_target_wallet_check
      CHECK (target_wallet IN ('primary','secondary'));
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS secondary_deposit_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.credit_wallet_for_payment(
  p_user_id uuid,
  p_amount numeric,
  p_wallet_kind text,
  p_reference_id uuid,
  p_description text,
  p_processed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := CASE WHEN p_wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;
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
      INSERT INTO public.secondary_wallets (user_id, balance)
      VALUES (p_user_id, 0)
      RETURNING id INTO v_wallet_id;
    END IF;
    SELECT COALESCE(balance, 0) INTO v_ledger_total FROM public.secondary_wallets WHERE id = v_wallet_id;
  ELSE
    SELECT id, COALESCE(balance, 0) INTO v_wallet_id, v_ledger_total
    FROM public.wallets WHERE user_id = p_user_id;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, balance)
      VALUES (p_user_id, 0)
      RETURNING id INTO v_wallet_id;
      v_ledger_total := 0;
    END IF;
  END IF;

  v_new_balance := v_ledger_total + p_amount;

  -- Ledger row FIRST: duplicate-credit triggers reject a second row for the
  -- same reference, so a double approval fails before any money is added.
  INSERT INTO public.transactions (
    user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind
  ) VALUES (
    p_user_id, 'top_up', p_amount, v_new_balance, p_reference_id, p_description, p_processed_by, v_kind
  );

  IF v_kind = 'secondary' THEN
    UPDATE public.secondary_wallets SET balance = v_new_balance WHERE id = v_wallet_id;
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
$$;

GRANT EXECUTE ON FUNCTION public.credit_wallet_for_payment(uuid, numeric, text, uuid, text, text) TO authenticated, service_role;