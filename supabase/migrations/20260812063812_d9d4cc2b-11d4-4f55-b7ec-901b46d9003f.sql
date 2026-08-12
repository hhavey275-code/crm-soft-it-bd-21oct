-- 1) Frozen allowance for pre-existing historical drift
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS drift_allowance numeric NOT NULL DEFAULT 0;
ALTER TABLE public.secondary_wallets ADD COLUMN IF NOT EXISTS drift_allowance numeric NOT NULL DEFAULT 0;

UPDATE public.wallets w
SET drift_allowance = round(w.balance - coalesce(l.s, 0), 2)
FROM (
  SELECT user_id, sum(amount) s FROM public.transactions
  WHERE coalesce(wallet_kind,'primary') = 'primary' GROUP BY user_id
) l
WHERE l.user_id = w.user_id
  AND abs(w.balance - coalesce(l.s,0)) > 0.01;

UPDATE public.secondary_wallets sw
SET drift_allowance = round(sw.balance - coalesce(l.s, 0), 2)
FROM (
  SELECT user_id, sum(amount) s FROM public.transactions
  WHERE wallet_kind = 'secondary' GROUP BY user_id
) l
WHERE l.user_id = sw.user_id
  AND abs(sw.balance - coalesce(l.s,0)) > 0.01;

-- 2) Deferred integrity guard: at COMMIT time a wallet balance MUST equal
--    its own ledger sum (+ the frozen legacy allowance). Any miscalculation,
--    partial write, or balance that moves the wrong way aborts the whole
--    transaction instead of persisting wrong money.
CREATE OR REPLACE FUNCTION public.assert_wallet_matches_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := TG_ARGV[0];
  v_ledger numeric;
  v_expected numeric;
BEGIN
  SELECT coalesce(sum(amount),0) INTO v_ledger
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND coalesce(wallet_kind,'primary') = v_kind;

  v_expected := v_ledger + coalesce(NEW.drift_allowance, 0);

  IF abs(coalesce(NEW.balance,0) - v_expected) > 0.01 THEN
    RAISE EXCEPTION
      'Wallet integrity check failed (% wallet, user %): balance % but transaction history says % (allowance %). Change rejected to protect money accuracy.',
      v_kind, NEW.user_id, NEW.balance, v_ledger, coalesce(NEW.drift_allowance,0)
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS assert_primary_wallet_integrity ON public.wallets;
CREATE CONSTRAINT TRIGGER assert_primary_wallet_integrity
AFTER INSERT OR UPDATE OF balance, drift_allowance ON public.wallets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_wallet_matches_ledger('primary');

DROP TRIGGER IF EXISTS assert_secondary_wallet_integrity ON public.secondary_wallets;
CREATE CONSTRAINT TRIGGER assert_secondary_wallet_integrity
AFTER INSERT OR UPDATE OF balance, drift_allowance ON public.secondary_wallets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_wallet_matches_ledger('secondary');

-- 3) One-stop money health report (admin only)
CREATE OR REPLACE FUNCTION public.money_health_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_drift jsonb;
  v_uncredited jsonb;
  v_dupes jsonb;
  v_suspect_failed jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'superadmin')) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY abs(x_drift) DESC), '[]'::jsonb) INTO v_drift
  FROM (
    SELECT jsonb_build_object(
             'user_id', w.user_id,
             'name', coalesce(p.full_name, p.email),
             'wallet_kind', 'primary',
             'balance', w.balance,
             'ledger_total', coalesce(l.s,0),
             'allowance', w.drift_allowance,
             'drift', round(w.balance - coalesce(l.s,0) - w.drift_allowance, 2)
           ) x,
           round(w.balance - coalesce(l.s,0) - w.drift_allowance, 2) x_drift
    FROM public.wallets w
    LEFT JOIN (SELECT user_id, sum(amount) s FROM public.transactions
               WHERE coalesce(wallet_kind,'primary')='primary' GROUP BY user_id) l
      ON l.user_id = w.user_id
    LEFT JOIN public.profiles p ON p.user_id = w.user_id
    WHERE abs(w.balance - coalesce(l.s,0) - w.drift_allowance) > 0.01
    UNION ALL
    SELECT jsonb_build_object(
             'user_id', sw.user_id,
             'name', coalesce(p.full_name, p.email),
             'wallet_kind', 'secondary',
             'balance', sw.balance,
             'ledger_total', coalesce(l.s,0),
             'allowance', sw.drift_allowance,
             'drift', round(sw.balance - coalesce(l.s,0) - sw.drift_allowance, 2)
           ),
           round(sw.balance - coalesce(l.s,0) - sw.drift_allowance, 2)
    FROM public.secondary_wallets sw
    LEFT JOIN (SELECT user_id, sum(amount) s FROM public.transactions
               WHERE wallet_kind='secondary' GROUP BY user_id) l
      ON l.user_id = sw.user_id
    LEFT JOIN public.profiles p ON p.user_id = sw.user_id
    WHERE abs(sw.balance - coalesce(l.s,0) - sw.drift_allowance) > 0.01
  ) q;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'request_id', r.id,
           'user_id', r.user_id,
           'name', coalesce(p.full_name, p.email),
           'amount', r.amount,
           'created_at', r.created_at
         ) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_uncredited
  FROM public.top_up_requests r
  LEFT JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.status = 'approved'
    AND coalesce(r.amount,0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.reference_id = r.id AND t.type = 'top_up'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.reference_id = r.id AND t.description ILIKE '%due adjustment%'
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'reference_id', t.reference_id,
           'user_id', t.user_id,
           'credits', t.c,
           'total_amount', t.a
         )), '[]'::jsonb) INTO v_dupes
  FROM (
    SELECT reference_id, min(user_id) user_id, count(*) c, sum(amount) a
    FROM public.transactions
    WHERE type = 'top_up' AND reference_id IS NOT NULL
    GROUP BY reference_id
    HAVING count(*) > 1
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'failed_topup_id', f.id,
           'user_id', f.user_id,
           'name', coalesce(p.full_name, p.email),
           'amount', f.amount,
           'ad_account', a.account_name,
           'account_id', a.account_id,
           'current_spend_cap', a.spend_cap,
           'created_at', f.created_at
         ) ORDER BY f.created_at DESC), '[]'::jsonb) INTO v_suspect_failed
  FROM public.failed_topups f
  LEFT JOIN public.ad_accounts a ON a.id = f.ad_account_id
  LEFT JOIN public.profiles p ON p.user_id = f.user_id
  WHERE f.status = 'pending'
    AND f.created_at > now() - interval '30 days';

  RETURN jsonb_build_object(
    'generated_at', now(),
    'wallet_drift', v_drift,
    'approved_not_credited', v_uncredited,
    'duplicate_credits', v_dupes,
    'pending_failed_topups', v_suspect_failed
  );
END;
$$;

-- 4) Admin repair: snap a wallet balance back onto its ledger, logged
CREATE OR REPLACE FUNCTION public.repair_wallet_balance(p_user_id uuid, p_wallet_kind text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_kind text := CASE WHEN p_wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;
  v_before numeric;
  v_ledger numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'superadmin')) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'reason required'; END IF;

  SELECT coalesce(sum(amount),0) INTO v_ledger
  FROM public.transactions
  WHERE user_id = p_user_id AND coalesce(wallet_kind,'primary') = v_kind;

  IF v_kind = 'secondary' THEN
    SELECT balance INTO v_before FROM public.secondary_wallets WHERE user_id = p_user_id FOR UPDATE;
    UPDATE public.secondary_wallets
       SET balance = v_ledger, drift_allowance = 0, updated_at = now()
     WHERE user_id = p_user_id;
  ELSE
    SELECT balance INTO v_before FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
    UPDATE public.wallets
       SET balance = v_ledger, drift_allowance = 0, updated_at = now()
     WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.system_logs (user_id, user_name, action, details)
  VALUES (
    v_actor,
    coalesce((SELECT full_name FROM public.profiles WHERE user_id = v_actor),
             (SELECT email FROM public.profiles WHERE user_id = v_actor), 'admin'),
    'Wallet Balance Repaired',
    'User ' || p_user_id::text || ' (' || v_kind || '): $' || coalesce(v_before,0) || ' → $' || v_ledger || '. Reason: ' || p_reason
  );

  RETURN jsonb_build_object('ok', true, 'wallet_kind', v_kind, 'balance_before', v_before, 'balance_after', v_ledger);
END;
$$;

REVOKE ALL ON FUNCTION public.money_health_report() FROM anon;
REVOKE ALL ON FUNCTION public.repair_wallet_balance(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.money_health_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_wallet_balance(uuid, text, text) TO authenticated;