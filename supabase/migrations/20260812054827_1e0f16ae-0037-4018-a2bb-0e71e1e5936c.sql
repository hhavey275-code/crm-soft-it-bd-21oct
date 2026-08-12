ALTER TABLE public.failed_topups
  ADD COLUMN IF NOT EXISTS wallet_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS expected_spend_cap numeric,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_category text NOT NULL DEFAULT 'meta_rejected',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS recommended_action text,
  ADD COLUMN IF NOT EXISTS meta_error_code text,
  ADD COLUMN IF NOT EXISTS meta_error_subcode text,
  ADD COLUMN IF NOT EXISTS http_status integer;

CREATE UNIQUE INDEX IF NOT EXISTS failed_topups_wallet_transaction_unique
  ON public.failed_topups (wallet_transaction_id)
  WHERE wallet_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS failed_topups_pending_verification_idx
  ON public.failed_topups (status, verification_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.refund_failed_topup(p_failed_topup_id uuid, p_processed_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ft record;
  v_debit record;
  v_existing_refund record;
  v_kind text;
  v_wallet_id uuid;
  v_bal numeric := 0;
  v_ledger numeric := 0;
  v_new numeric;
  v_desc text;
  v_acc record;
  v_refund_txn_id uuid;
BEGIN
  SELECT * INTO v_ft
  FROM public.failed_topups
  WHERE id = p_failed_topup_id AND status = 'pending'
  FOR UPDATE;

  IF v_ft IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Failed top-up not found or already resolved');
  END IF;

  v_kind := CASE WHEN v_ft.wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;

  IF v_ft.wallet_transaction_id IS NOT NULL THEN
    SELECT * INTO v_debit
    FROM public.transactions
    WHERE id = v_ft.wallet_transaction_id
      AND user_id = v_ft.user_id
      AND type = 'ad_topup'
      AND amount = -v_ft.amount
    FOR UPDATE;

    IF v_debit IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Original wallet deduction could not be verified; refund blocked for manual review'
      );
    END IF;

    v_kind := CASE WHEN v_debit.wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;

    SELECT * INTO v_existing_refund
    FROM public.transactions
    WHERE user_id = v_ft.user_id
      AND type = 'refund'
      AND processed_by = 'failed_topup_refund:' || p_failed_topup_id::text
    LIMIT 1;

    IF v_existing_refund IS NOT NULL THEN
      DELETE FROM public.failed_topups WHERE id = p_failed_topup_id;
      RETURN jsonb_build_object(
        'success', true,
        'already_refunded', true,
        'refunded_amount', v_ft.amount,
        'wallet_kind', v_kind,
        'new_balance', v_existing_refund.balance_after,
        'transaction_id', v_existing_refund.id
      );
    END IF;
  END IF;

  SELECT account_name, account_id INTO v_acc
  FROM public.ad_accounts WHERE id = v_ft.ad_account_id;

  IF v_kind = 'secondary' THEN
    SELECT id, COALESCE(balance, 0) INTO v_wallet_id, v_bal
    FROM public.secondary_wallets WHERE user_id = v_ft.user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.secondary_wallets (user_id, balance)
      VALUES (v_ft.user_id, 0)
      RETURNING id, balance INTO v_wallet_id, v_bal;
    END IF;
  ELSE
    SELECT id, COALESCE(balance, 0) INTO v_wallet_id, v_bal
    FROM public.wallets WHERE user_id = v_ft.user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, balance)
      VALUES (v_ft.user_id, 0)
      RETURNING id, balance INTO v_wallet_id, v_bal;
    END IF;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_ledger
  FROM public.transactions
  WHERE user_id = v_ft.user_id
    AND COALESCE(wallet_kind, 'primary') = v_kind;

  IF ABS(v_bal - v_ledger) > 0.01 THEN
    v_bal := v_ledger;
  END IF;

  v_new := v_bal + v_ft.amount;
  v_desc := 'Refund: Failed top-up' ||
            COALESCE(E'\n' || v_acc.account_name, '') ||
            COALESCE(E'\n' || regexp_replace(COALESCE(v_acc.account_id, ''), '^act_', ''), '');

  INSERT INTO public.transactions
    (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind)
  VALUES
    (v_ft.user_id, 'refund', v_ft.amount, v_new, v_ft.ad_account_id, v_desc,
     'failed_topup_refund:' || p_failed_topup_id::text, v_kind)
  RETURNING id INTO v_refund_txn_id;

  IF v_kind = 'secondary' THEN
    UPDATE public.secondary_wallets SET balance = v_new, updated_at = now() WHERE id = v_wallet_id;
  ELSE
    UPDATE public.wallets SET balance = v_new, updated_at = now() WHERE id = v_wallet_id;
  END IF;

  DELETE FROM public.failed_topups WHERE id = p_failed_topup_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_refunded', false,
    'refunded_amount', v_ft.amount,
    'wallet_kind', v_kind,
    'new_balance', v_new,
    'transaction_id', v_refund_txn_id,
    'original_transaction_id', v_ft.wallet_transaction_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_failed_topup(uuid, text) TO service_role;