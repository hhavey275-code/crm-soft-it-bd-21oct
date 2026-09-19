-- 1) Credit line wallet table
CREATE TABLE IF NOT EXISTS public.credit_line_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  drift_allowance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.credit_line_wallets TO authenticated;
GRANT ALL ON public.credit_line_wallets TO service_role;

ALTER TABLE public.credit_line_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own credit line wallet" ON public.credit_line_wallets;
CREATE POLICY "Users view own credit line wallet"
  ON public.credit_line_wallets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all credit line wallets" ON public.credit_line_wallets;
CREATE POLICY "Admins view all credit line wallets"
  ON public.credit_line_wallets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

DROP TRIGGER IF EXISTS update_credit_line_wallets_updated_at ON public.credit_line_wallets;
CREATE TRIGGER update_credit_line_wallets_updated_at
  BEFORE UPDATE ON public.credit_line_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Profile columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credit_line_wallet_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_line_usd_rate numeric,
  ADD COLUMN IF NOT EXISTS credit_line_due_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_line_due_limit_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_line_due_limit_expires_at timestamptz;

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS external_topup_url_credit_line text;

ALTER TABLE public.top_up_requests
  ADD COLUMN IF NOT EXISTS credit_line_due_bdt numeric;

-- 3) wallet_kind validation
CREATE OR REPLACE FUNCTION public.validate_wallet_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.wallet_kind IS NULL OR NEW.wallet_kind NOT IN ('primary','secondary','credit_line') THEN
    RAISE EXCEPTION 'invalid wallet_kind: %', NEW.wallet_kind;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) Integrity assertion supports the third wallet
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
  IF v_kind = 'primary' THEN
    SELECT COALESCE(w.balance, 0), COALESCE(w.drift_allowance, 0)
      INTO v_balance, v_allowance
      FROM public.wallets w WHERE w.id = NEW.id;
  ELSIF v_kind = 'credit_line' THEN
    SELECT COALESCE(w.balance, 0), COALESCE(w.drift_allowance, 0)
      INTO v_balance, v_allowance
      FROM public.credit_line_wallets w WHERE w.id = NEW.id;
  ELSE
    SELECT COALESCE(w.balance, 0), COALESCE(w.drift_allowance, 0)
      INTO v_balance, v_allowance
      FROM public.secondary_wallets w WHERE w.id = NEW.id;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_ledger
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND coalesce(wallet_kind,'primary') = v_kind;

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

DROP TRIGGER IF EXISTS assert_credit_line_wallet_integrity ON public.credit_line_wallets;
CREATE CONSTRAINT TRIGGER assert_credit_line_wallet_integrity
  AFTER INSERT OR UPDATE OF balance, drift_allowance ON public.credit_line_wallets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_wallet_matches_ledger('credit_line');

-- 5) effective_due_limit
CREATE OR REPLACE FUNCTION public.effective_due_limit(p_user_id uuid, p_wallet_kind text DEFAULT 'primary'::text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_wallet_kind = 'secondary' THEN
      CASE WHEN p.secondary_due_limit_expires_at IS NOT NULL
                AND p.secondary_due_limit_expires_at <= now()
           THEN 0 ELSE COALESCE(p.secondary_due_limit, 0) END
    WHEN p_wallet_kind = 'credit_line' THEN
      CASE WHEN p.credit_line_due_limit_expires_at IS NOT NULL
                AND p.credit_line_due_limit_expires_at <= now()
           THEN 0 ELSE COALESCE(p.credit_line_due_limit, 0) END
    ELSE
      CASE WHEN p.due_limit_expires_at IS NOT NULL
                AND p.due_limit_expires_at <= now()
           THEN 0 ELSE COALESCE(p.due_limit, 0) END
  END
  FROM public.profiles p
  WHERE p.user_id = p_user_id
$function$;

-- 6) adjust_wallet_atomic
CREATE OR REPLACE FUNCTION public.adjust_wallet_atomic(p_user_id uuid, p_amount numeric, p_type text, p_description text, p_processed_by text, p_wallet_kind text DEFAULT 'primary'::text, p_reference_id uuid DEFAULT NULL::uuid, p_allow_negative boolean DEFAULT true)
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
  ELSIF v_kind = 'credit_line' THEN
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.credit_line_wallets WHERE user_id = p_user_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.credit_line_wallets (user_id, balance, drift_allowance)
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
  ELSIF v_kind = 'credit_line' THEN
    UPDATE public.credit_line_wallets SET balance = v_new, updated_at = now() WHERE id = v_wallet_id;
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
$function$;

-- 7) deduct_wallet_for_topup_v2 with credit_line support
CREATE OR REPLACE FUNCTION public.deduct_wallet_for_topup_v2(p_user_id uuid, p_amount numeric, p_ad_account_id uuid, p_description text, p_processed_by text, p_wallet_kind text DEFAULT 'primary'::text, p_allow_negative boolean DEFAULT false, p_due_limit numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_wallet_kind NOT IN ('primary','secondary','credit_line') THEN RAISE EXCEPTION 'invalid wallet kind %', p_wallet_kind; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user_id::text, 0));

  IF p_wallet_kind = 'primary' THEN
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(usd_rate,0) INTO v_rate FROM public.profiles WHERE user_id = p_user_id;
  ELSIF p_wallet_kind = 'credit_line' THEN
    INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.credit_line_wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(credit_line_usd_rate, usd_rate, 0) INTO v_rate
      FROM public.profiles WHERE user_id = p_user_id;
  ELSE
    SELECT id, COALESCE(balance,0), COALESCE(drift_allowance,0)
      INTO v_wallet_id, v_balance, v_allowance
      FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
    SELECT COALESCE(secondary_usd_rate, usd_rate, 0) INTO v_rate
      FROM public.profiles WHERE user_id = p_user_id;
  END IF;

  IF v_wallet_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found'); END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_ledger
    FROM public.transactions
   WHERE user_id = p_user_id AND COALESCE(wallet_kind,'primary') = p_wallet_kind;
  v_expected := v_ledger + v_allowance;
  IF ABS(v_balance - v_expected) > 0.01 THEN
    RAISE EXCEPTION 'Wallet integrity mismatch before deduction (% wallet, user %): balance %, expected % (ledger %, allowance %)',
      p_wallet_kind, p_user_id, v_balance, v_expected, v_ledger, v_allowance USING ERRCODE = '23514';
  END IF;

  IF NOT p_allow_negative AND (v_balance + COALESCE(p_due_limit,0)) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'balance', v_balance, 'wallet_kind', p_wallet_kind);
  END IF;

  v_new_balance := v_balance - p_amount;
  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, reference_id, processed_by, wallet_kind, usd_rate_used)
  VALUES
    (p_user_id, -p_amount, v_new_balance, 'ad_topup', p_description, p_ad_account_id, p_processed_by, p_wallet_kind, NULLIF(v_rate,0))
  RETURNING id INTO v_txn_id;

  IF p_wallet_kind = 'primary' THEN
    UPDATE public.wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  ELSIF p_wallet_kind = 'credit_line' THEN
    UPDATE public.credit_line_wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  ELSE
    UPDATE public.secondary_wallets SET balance = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'wallet_id', v_wallet_id, 'wallet_kind', p_wallet_kind,
    'balance_before', v_balance, 'balance_after', v_new_balance, 'transaction_id', v_txn_id,
    'reconciled', false, 'usd_rate_used', v_rate);
END;
$function$;

-- 8) ensure_credit_line_funds (auto convert from main)
CREATE OR REPLACE FUNCTION public.ensure_credit_line_funds(p_user_id uuid, p_needed_usd numeric, p_processed_by text DEFAULT NULL::text, p_allow_negative boolean DEFAULT false, p_due_limit numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_main_rate numeric;
  v_cl_rate numeric;
  v_site_rate numeric;
  v_main numeric := 0;
  v_cl numeric := 0;
  v_short numeric;
  v_convert numeric;
  v_credit numeric;
  v_by text;
  v_res jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'superadmin');
  IF NOT v_is_admin AND v_actor <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_needed_usd IS NULL OR p_needed_usd <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet-topup:' || p_user_id::text, 0));

  SELECT NULLIF(usd_rate, 0), NULLIF(credit_line_usd_rate, 0)
    INTO v_main_rate, v_cl_rate
  FROM public.profiles WHERE user_id = p_user_id;
  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';
  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_cl_rate, 1);
  v_cl_rate := COALESCE(v_cl_rate, v_main_rate);

  INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance, 0) INTO v_main
    FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance, 0) INTO v_cl
    FROM public.credit_line_wallets WHERE user_id = p_user_id FOR UPDATE;

  v_short := ROUND(p_needed_usd - COALESCE(v_cl, 0), 2);
  IF v_short <= 0.009 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0,
      'credit_line_balance', v_cl, 'main_balance', v_main,
      'main_rate', v_main_rate, 'credit_line_rate', v_cl_rate);
  END IF;

  v_convert := ROUND(v_short * v_cl_rate / v_main_rate, 2);
  IF v_convert > GREATEST(COALESCE(v_main, 0), 0) THEN
    v_convert := ROUND(GREATEST(COALESCE(v_main, 0), 0), 2);
  END IF;
  IF v_convert <= 0.009 THEN
    RETURN jsonb_build_object('ok', true, 'converted', 0, 'credited', 0,
      'shortfall', v_short, 'credit_line_balance', v_cl, 'main_balance', v_main,
      'main_rate', v_main_rate, 'credit_line_rate', v_cl_rate);
  END IF;

  v_credit := LEAST(ROUND(v_convert * v_main_rate / v_cl_rate, 2), v_short);
  v_by := COALESCE(p_processed_by,
    CASE WHEN v_is_admin THEN 'admin:' || v_actor::text ELSE 'client:' || v_actor::text END);

  v_res := public.adjust_wallet_atomic(p_user_id, -v_convert, 'adjustment',
    'Converted to Credit Line wallet (rate ' || v_main_rate || ' -> ' || v_cl_rate || ')',
    v_by, 'primary', NULL, true);
  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_res->>'error', 'conversion_failed'));
  END IF;

  v_res := public.adjust_wallet_atomic(p_user_id, v_credit, 'adjustment',
    'Received from Main wallet (rate converted ' || v_main_rate || ' -> ' || v_cl_rate || ')',
    v_by, 'credit_line', NULL, true);
  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    RAISE EXCEPTION 'Credit line wallet conversion credit failed: %', COALESCE(v_res->>'error', 'conversion_failed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'converted', v_convert, 'credited', v_credit,
    'shortfall', v_short, 'main_rate', v_main_rate, 'credit_line_rate', v_cl_rate,
    'credit_line_balance', COALESCE(v_cl, 0) + v_credit);
END;
$function$;

-- 9) Admin adjust + convert
CREATE OR REPLACE FUNCTION public.admin_adjust_credit_line_wallet(p_user_id uuid, p_amount numeric, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  INSERT INTO public.credit_line_wallets (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT id, COALESCE(balance,0) INTO v_wallet_id, v_balance
    FROM public.credit_line_wallets WHERE user_id = p_user_id FOR UPDATE;

  SELECT COALESCE(credit_line_usd_rate, usd_rate, 0) INTO v_rate
    FROM public.profiles WHERE user_id = p_user_id;

  v_new_balance := v_balance + p_amount;

  UPDATE public.credit_line_wallets
     SET balance = v_new_balance, updated_at = now()
   WHERE id = v_wallet_id;

  INSERT INTO public.transactions
    (user_id, amount, balance_after, type, description, processed_by, wallet_kind, usd_rate_used)
  VALUES
    (p_user_id, p_amount, v_new_balance,
     CASE WHEN p_amount > 0 THEN 'top_up' ELSE 'adjustment' END,
     'Credit line wallet adjustment: ' || p_reason,
     'admin:' || v_actor::text, 'credit_line', NULLIF(v_rate,0))
  RETURNING id INTO v_txn_id;

  INSERT INTO public.system_logs (user_id, user_name, action, details)
  VALUES (
    v_actor,
    COALESCE((SELECT full_name FROM public.profiles WHERE user_id = v_actor),
             (SELECT email FROM public.profiles WHERE user_id = v_actor), 'admin'),
    'Credit Line Wallet Adjusted',
    'User ' || p_user_id::text || ': $' || p_amount || ' (balance $' || v_balance || ' → $' || v_new_balance || '). Reason: ' || p_reason
  );

  RETURN jsonb_build_object('ok', true, 'balance_before', v_balance,
    'balance_after', v_new_balance, 'transaction_id', v_txn_id);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_convert_main_to_credit_line(p_user_id uuid, p_usd_amount numeric, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_main_rate numeric;
  v_cl_rate numeric;
  v_site_rate numeric;
  v_main numeric;
  v_cl numeric;
  v_credit numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'superadmin')) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  IF p_usd_amount IS NULL OR p_usd_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT NULLIF(usd_rate,0), NULLIF(credit_line_usd_rate,0)
    INTO v_main_rate, v_cl_rate
  FROM public.profiles WHERE user_id = p_user_id;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';

  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_cl_rate, 1);
  v_cl_rate   := COALESCE(v_cl_rate, v_main_rate);

  INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance,0) INTO v_main FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance,0) INTO v_cl FROM public.credit_line_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_main < p_usd_amount THEN
    RAISE EXCEPTION 'Main wallet balance is only $%', v_main;
  END IF;

  v_credit := ROUND(p_usd_amount * v_main_rate / v_cl_rate, 2);

  UPDATE public.wallets SET balance = v_main - p_usd_amount, updated_at = now() WHERE user_id = p_user_id;
  UPDATE public.credit_line_wallets SET balance = v_cl + v_credit, updated_at = now() WHERE user_id = p_user_id;

  INSERT INTO public.transactions
    (user_id, type, amount, balance_after, description, processed_by, wallet_kind, usd_rate_used)
  VALUES (p_user_id, 'adjustment', -p_usd_amount, v_main - p_usd_amount,
          'Moved to Credit Line wallet (rate ' || v_main_rate || ' -> ' || v_cl_rate || ')'
            || COALESCE(': ' || p_reason, ''),
          'admin:' || v_actor::text, 'primary', v_main_rate);

  INSERT INTO public.transactions
    (user_id, type, amount, balance_after, description, processed_by, wallet_kind, usd_rate_used)
  VALUES (p_user_id, 'adjustment', v_credit, v_cl + v_credit,
          'Received from Main wallet (rate converted)' || COALESCE(': ' || p_reason, ''),
          'admin:' || v_actor::text, 'credit_line', v_cl_rate);

  INSERT INTO public.system_logs (user_id, user_name, action, details)
  VALUES (v_actor,
          COALESCE((SELECT full_name FROM public.profiles WHERE user_id = v_actor),
                   (SELECT email FROM public.profiles WHERE user_id = v_actor), 'admin'),
          'Main → Credit Line Wallet Conversion',
          'User ' || p_user_id::text || ': $' || p_usd_amount || ' @ ৳' || v_main_rate
            || ' → $' || v_credit || ' @ ৳' || v_cl_rate || COALESCE('. Reason: ' || p_reason, ''));

  RETURN jsonb_build_object('ok', true, 'moved', p_usd_amount, 'credited', v_credit,
    'main_after', v_main - p_usd_amount, 'credit_line_after', v_cl + v_credit);
END;
$function$;

-- 10) Deposit distribution across the client's enabled wallets only
CREATE OR REPLACE FUNCTION public.distribute_deposit_bdt(p_user_id uuid, p_bdt_amount numeric, p_reference_id uuid, p_processed_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main_rate numeric;
  v_sec_rate numeric;
  v_cl_rate numeric;
  v_site_rate numeric;
  v_sec_on boolean := false;
  v_cl_on boolean := false;
  v_main numeric;
  v_sec numeric;
  v_cl numeric;
  v_main_start numeric;
  v_sec_start numeric;
  v_cl_start numeric;
  v_remaining numeric := COALESCE(p_bdt_amount, 0);
  v_main_due_bdt numeric := 0;
  v_sec_due_bdt numeric := 0;
  v_cl_due_bdt numeric := 0;
  v_main_dep_bdt numeric := 0;
  v_usd numeric;
  v_ref uuid := p_reference_id;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount must be > 0');
  END IF;

  SELECT NULLIF(usd_rate, 0), NULLIF(secondary_usd_rate, 0), NULLIF(credit_line_usd_rate, 0),
         COALESCE(secondary_wallet_enabled,false), COALESCE(credit_line_wallet_enabled,false)
    INTO v_main_rate, v_sec_rate, v_cl_rate, v_sec_on, v_cl_on
  FROM public.profiles WHERE user_id = p_user_id;

  SELECT NULLIF((value)::numeric, 0) INTO v_site_rate
  FROM public.site_settings WHERE key = 'usd_rate';

  v_main_rate := COALESCE(v_main_rate, v_site_rate, v_sec_rate, v_cl_rate);
  v_sec_rate  := COALESCE(v_sec_rate, v_main_rate);
  v_cl_rate   := COALESCE(v_cl_rate, v_main_rate);
  IF COALESCE(v_main_rate, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no usable usd rate');
  END IF;

  INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.secondary_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_line_wallets (user_id, balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(balance, 0) INTO v_main FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance, 0) INTO v_sec FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(balance, 0) INTO v_cl FROM public.credit_line_wallets WHERE user_id = p_user_id FOR UPDATE;
  v_main_start := v_main;
  v_sec_start := v_sec;
  v_cl_start := v_cl;

  -- 1) Main wallet due
  IF v_main < 0 THEN
    v_main_due_bdt := LEAST(ABS(v_main) * v_main_rate, v_remaining);
    v_remaining := v_remaining - v_main_due_bdt;
    v_usd := ROUND(v_main_due_bdt / v_main_rate, 2);
    IF v_usd > 0 THEN
      v_main := v_main + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_main, v_ref,
              'Main wallet due adjustment (৳' || ROUND(v_main_due_bdt) || ' @ ৳' || v_main_rate || '/USD)',
              p_processed_by, 'primary', v_main_rate);
      v_ref := NULL;
    END IF;
  END IF;

  -- 2) Secondary wallet due (only when that wallet is enabled)
  IF v_sec_on AND v_remaining > 0 AND v_sec < 0 AND COALESCE(v_sec_rate, 0) > 0 THEN
    v_sec_due_bdt := LEAST(ABS(v_sec) * v_sec_rate, v_remaining);
    v_remaining := v_remaining - v_sec_due_bdt;
    v_usd := ROUND(v_sec_due_bdt / v_sec_rate, 2);
    IF v_usd > 0 THEN
      v_sec := v_sec + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_sec, v_ref,
              'Secondary wallet due adjustment (৳' || ROUND(v_sec_due_bdt) || ' @ ৳' || v_sec_rate || '/USD)',
              p_processed_by, 'secondary', v_sec_rate);
      v_ref := NULL;
    END IF;
  END IF;

  -- 3) Credit line wallet due (only when that wallet is enabled)
  IF v_cl_on AND v_remaining > 0 AND v_cl < 0 AND COALESCE(v_cl_rate, 0) > 0 THEN
    v_cl_due_bdt := LEAST(ABS(v_cl) * v_cl_rate, v_remaining);
    v_remaining := v_remaining - v_cl_due_bdt;
    v_usd := ROUND(v_cl_due_bdt / v_cl_rate, 2);
    IF v_usd > 0 THEN
      v_cl := v_cl + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_cl, v_ref,
              'Credit line wallet due adjustment (৳' || ROUND(v_cl_due_bdt) || ' @ ৳' || v_cl_rate || '/USD)',
              p_processed_by, 'credit_line', v_cl_rate);
      v_ref := NULL;
    END IF;
  END IF;

  -- 4) Remainder deposited to the main wallet
  IF v_remaining > 0 THEN
    v_main_dep_bdt := v_remaining;
    v_usd := ROUND(v_main_dep_bdt / v_main_rate, 2);
    v_remaining := 0;
    IF v_usd > 0 THEN
      v_main := v_main + v_usd;
      INSERT INTO public.transactions
        (user_id, type, amount, balance_after, reference_id, description, processed_by, wallet_kind, usd_rate_used)
      VALUES (p_user_id, 'top_up', v_usd, v_main, v_ref,
              'Main wallet deposit (৳' || ROUND(v_main_dep_bdt) || ' @ ৳' || v_main_rate || '/USD)',
              p_processed_by, 'primary', v_main_rate);
      v_ref := NULL;
    END IF;
  END IF;

  IF v_main IS DISTINCT FROM v_main_start THEN
    UPDATE public.wallets SET balance = v_main, updated_at = now() WHERE user_id = p_user_id;
  END IF;
  IF v_sec IS DISTINCT FROM v_sec_start THEN
    UPDATE public.secondary_wallets SET balance = v_sec, updated_at = now() WHERE user_id = p_user_id;
  END IF;
  IF v_cl IS DISTINCT FROM v_cl_start THEN
    UPDATE public.credit_line_wallets SET balance = v_cl, updated_at = now() WHERE user_id = p_user_id;
  END IF;

  IF p_reference_id IS NOT NULL THEN
    UPDATE public.top_up_requests
       SET main_due_bdt = v_main_due_bdt,
           secondary_due_bdt = v_sec_due_bdt,
           credit_line_due_bdt = v_cl_due_bdt,
           main_deposit_bdt = v_main_dep_bdt
     WHERE id = p_reference_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'main_due_bdt', v_main_due_bdt,
    'secondary_due_bdt', v_sec_due_bdt,
    'credit_line_due_bdt', v_cl_due_bdt,
    'main_deposit_bdt', v_main_dep_bdt,
    'main_balance', v_main,
    'secondary_balance', v_sec,
    'credit_line_balance', v_cl,
    'main_rate', v_main_rate,
    'secondary_rate', v_sec_rate,
    'credit_line_rate', v_cl_rate
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_credit_line_funds(uuid, numeric, text, boolean, numeric) FROM anon;
