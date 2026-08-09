-- 1. Profile flags
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS secondary_wallet_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS secondary_usd_rate numeric;

-- 2. Secondary wallets table
CREATE TABLE IF NOT EXISTS public.secondary_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.secondary_wallets TO authenticated;
GRANT ALL ON public.secondary_wallets TO service_role;

ALTER TABLE public.secondary_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own secondary wallet" ON public.secondary_wallets;
CREATE POLICY "Users view own secondary wallet"
  ON public.secondary_wallets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all secondary wallets" ON public.secondary_wallets;
CREATE POLICY "Admins view all secondary wallets"
  ON public.secondary_wallets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

DROP TRIGGER IF EXISTS update_secondary_wallets_updated_at ON public.secondary_wallets;
CREATE TRIGGER update_secondary_wallets_updated_at
  BEFORE UPDATE ON public.secondary_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Transactions: wallet kind + rate used
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS wallet_kind text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS usd_rate_used numeric;

CREATE OR REPLACE FUNCTION public.validate_wallet_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.wallet_kind IS NULL OR NEW.wallet_kind NOT IN ('primary','secondary') THEN
    RAISE EXCEPTION 'invalid wallet_kind: %', NEW.wallet_kind;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_wallet_kind_trg ON public.transactions;
CREATE TRIGGER validate_wallet_kind_trg
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_wallet_kind();

CREATE INDEX IF NOT EXISTS idx_transactions_user_wallet_kind
  ON public.transactions (user_id, wallet_kind);

-- 4. Ensure secondary wallet rows for enabled clients (none yet, but idempotent)
INSERT INTO public.secondary_wallets (user_id)
SELECT p.user_id FROM public.profiles p
WHERE p.secondary_wallet_enabled = true
  AND NOT EXISTS (SELECT 1 FROM public.secondary_wallets sw WHERE sw.user_id = p.user_id);

-- 5. Wallet-kind aware atomic deduction
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
SET search_path = public
AS $$
DECLARE
  v_wallet_id uuid;
  v_balance numeric;
  v_ledger numeric;
  v_reconciled boolean := false;
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
    SELECT id, COALESCE(balance,0) INTO v_wallet_id, v_balance
      FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(usd_rate,0) INTO v_rate FROM public.profiles WHERE user_id = p_user_id;
  ELSE
    SELECT id, COALESCE(balance,0) INTO v_wallet_id, v_balance
      FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(secondary_usd_rate, usd_rate, 0) INTO v_rate
      FROM public.profiles WHERE user_id = p_user_id;
  END IF;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_ledger
    FROM public.transactions
   WHERE user_id = p_user_id AND wallet_kind = p_wallet_kind;

  IF ABS(v_balance - v_ledger) > 0.01 THEN
    v_reconciled := true;
    v_balance := v_ledger;
    IF p_wallet_kind = 'primary' THEN
      UPDATE public.wallets SET balance = v_ledger, updated_at = now() WHERE id = v_wallet_id;
    ELSE
      UPDATE public.secondary_wallets SET balance = v_ledger, updated_at = now() WHERE id = v_wallet_id;
    END IF;
  END IF;

  IF NOT p_allow_negative
     AND (v_balance + CASE WHEN p_wallet_kind = 'primary' THEN COALESCE(p_due_limit,0) ELSE 0 END) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance',
      'balance', v_balance, 'reconciled', v_reconciled, 'wallet_kind', p_wallet_kind);
  END IF;

  v_new_balance := v_balance - p_amount;

  IF p_wallet_kind = 'primary' THEN
    UPDATE public.wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  ELSE
    UPDATE public.secondary_wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  END IF;

  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, reference_id, processed_by, wallet_kind, usd_rate_used)
  VALUES
    (p_user_id, -p_amount, v_new_balance, 'ad_topup', p_description, p_ad_account_id, p_processed_by, p_wallet_kind, NULLIF(v_rate,0))
  RETURNING id INTO v_txn_id;

  RETURN jsonb_build_object(
    'ok', true,
    'wallet_id', v_wallet_id,
    'wallet_kind', p_wallet_kind,
    'balance_before', v_balance,
    'balance_after', v_new_balance,
    'transaction_id', v_txn_id,
    'reconciled', v_reconciled,
    'usd_rate_used', v_rate
  );
END $$;

REVOKE ALL ON FUNCTION public.deduct_wallet_for_topup_v2(uuid, numeric, uuid, text, text, text, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_wallet_for_topup_v2(uuid, numeric, uuid, text, text, text, boolean, numeric) TO service_role;

-- 6. Admin-only secondary wallet adjustment
CREATE OR REPLACE FUNCTION public.admin_adjust_secondary_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_wallet_id uuid;
  v_balance numeric;
  v_new_balance numeric;
  v_txn_id uuid;
  v_rate numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'superadmin')) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'amount required'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'reason required'; END IF;

  INSERT INTO public.secondary_wallets (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT id, COALESCE(balance,0) INTO v_wallet_id, v_balance
    FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;

  SELECT COALESCE(secondary_usd_rate, usd_rate, 0) INTO v_rate
    FROM public.profiles WHERE user_id = p_user_id;

  v_new_balance := v_balance + p_amount;

  UPDATE public.secondary_wallets
     SET balance = v_new_balance, updated_at = now()
   WHERE id = v_wallet_id;

  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, processed_by, wallet_kind, usd_rate_used)
  VALUES
    (p_user_id, p_amount, v_new_balance,
     CASE WHEN p_amount > 0 THEN 'top_up' ELSE 'adjustment' END,
     'Secondary wallet adjustment: ' || p_reason,
     'admin:' || v_actor::text, 'secondary', NULLIF(v_rate,0))
  RETURNING id INTO v_txn_id;

  INSERT INTO public.system_logs (user_id, user_name, action, details)
  VALUES (
    v_actor,
    COALESCE((SELECT full_name FROM public.profiles WHERE user_id = v_actor),
             (SELECT email FROM public.profiles WHERE user_id = v_actor), 'admin'),
    'Secondary Wallet Adjusted',
    'User ' || p_user_id::text || ': $' || p_amount || ' (balance $' || v_balance || ' → $' || v_new_balance || '). Reason: ' || p_reason
  );

  RETURN jsonb_build_object(
    'ok', true,
    'balance_before', v_balance,
    'balance_after', v_new_balance,
    'transaction_id', v_txn_id
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_adjust_secondary_wallet(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_secondary_wallet(uuid, numeric, text) TO authenticated, service_role;

-- 7. Keep secondary wallet row in sync when the feature is toggled on
CREATE OR REPLACE FUNCTION public.ensure_secondary_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.secondary_wallet_enabled = true THEN
    INSERT INTO public.secondary_wallets (user_id) VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ensure_secondary_wallet_trg ON public.profiles;
CREATE TRIGGER ensure_secondary_wallet_trg
  AFTER INSERT OR UPDATE OF secondary_wallet_enabled ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_secondary_wallet();