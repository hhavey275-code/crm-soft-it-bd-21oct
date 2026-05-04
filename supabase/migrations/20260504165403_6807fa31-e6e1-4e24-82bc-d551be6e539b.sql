
-- ============================================================
-- 1) Unified ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_limit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  amount_delta numeric NOT NULL,
  system_limit_before numeric,
  system_limit_after numeric,
  total_used_before numeric,
  total_used_after numeric,
  remaining_before numeric,
  remaining_after numeric,
  reason text,
  source text,
  source_id text,
  idempotency_key text,
  actor_user_id uuid,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_limit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read tenant_limit_ledger" ON public.tenant_limit_ledger;
CREATE POLICY "Admins read tenant_limit_ledger"
  ON public.tenant_limit_ledger FOR SELECT
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

DROP POLICY IF EXISTS "Superadmins manage tenant_limit_ledger" ON public.tenant_limit_ledger;
CREATE POLICY "Superadmins manage tenant_limit_ledger"
  ON public.tenant_limit_ledger FOR ALL
  USING (public.has_role(auth.uid(),'superadmin'))
  WITH CHECK (public.has_role(auth.uid(),'superadmin'));

CREATE INDEX IF NOT EXISTS idx_tenant_limit_ledger_tenant_created
  ON public.tenant_limit_ledger(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_limit_ledger_idem
  ON public.tenant_limit_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 2) Helper: insert ledger row using current tenant snapshot
-- ============================================================
CREATE OR REPLACE FUNCTION public._tll_insert(
  p_tenant_id uuid,
  p_movement_type text,
  p_delta numeric,
  p_limit_before numeric,
  p_limit_after numeric,
  p_used_before numeric,
  p_used_after numeric,
  p_reason text,
  p_source text,
  p_source_id text,
  p_idempotency_key text,
  p_actor uuid,
  p_meta jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.tenant_limit_ledger
    (tenant_id, movement_type, amount_delta,
     system_limit_before, system_limit_after,
     total_used_before, total_used_after,
     remaining_before, remaining_after,
     reason, source, source_id, idempotency_key, actor_user_id, meta)
  VALUES
    (p_tenant_id, p_movement_type, p_delta,
     p_limit_before, p_limit_after,
     p_used_before, p_used_after,
     COALESCE(p_limit_before,0) - COALESCE(p_used_before,0),
     COALESCE(p_limit_after,0)  - COALESCE(p_used_after,0),
     p_reason, p_source, p_source_id, p_idempotency_key, p_actor, p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ============================================================
-- 3) Approve tenant limit-purchase payment atomically
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_tenant_limit_payment(
  p_payment_id uuid,
  p_admin uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_payment public.tenant_payments;
  v_tenant_id uuid;
  v_limit_before numeric; v_used_before numeric;
  v_limit_after  numeric;
  v_usd numeric; v_rate numeric;
BEGIN
  SELECT * INTO v_payment FROM public.tenant_payments
   WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;

  v_tenant_id := v_payment.tenant_id;

  -- Lock tenant row
  SELECT system_limit, total_used INTO v_limit_before, v_used_before
    FROM public.tenants WHERE id = v_tenant_id FOR UPDATE;

  -- Idempotent: already approved → return current snapshot
  IF v_payment.status = 'approved' THEN
    RETURN jsonb_build_object(
      'already', true,
      'system_limit', v_limit_before,
      'total_used', v_used_before
    );
  END IF;

  IF v_payment.payment_type <> 'limit_purchase' THEN
    -- non limit-purchase: just mark approved, no limit change
    UPDATE public.tenant_payments
       SET status='approved', reviewed_by=p_admin, updated_at=now()
     WHERE id = p_payment_id;
    RETURN jsonb_build_object('already', false, 'no_limit_change', true);
  END IF;

  -- Determine USD delta
  IF v_payment.limit_amount IS NOT NULL AND v_payment.limit_amount > 0 THEN
    v_usd := v_payment.limit_amount;
  ELSE
    SELECT COALESCE(usd_rate,120) INTO v_rate FROM public.tenants WHERE id=v_tenant_id;
    v_usd := COALESCE(v_payment.amount,0) / NULLIF(v_rate,0);
  END IF;

  v_limit_after := COALESCE(v_limit_before,0) + COALESCE(v_usd,0);

  UPDATE public.tenants
     SET system_limit = v_limit_after,
         subscription_type = 'subscription_with_limit',
         updated_at = now()
   WHERE id = v_tenant_id;

  UPDATE public.tenant_payments
     SET status='approved', reviewed_by=p_admin, limit_amount=v_usd, updated_at=now()
   WHERE id = p_payment_id;

  PERFORM public._tll_insert(
    v_tenant_id, 'limit_purchase', v_usd,
    v_limit_before, v_limit_after,
    v_used_before, v_used_before,
    'Approved limit_purchase payment',
    'tenant_payments', p_payment_id::text,
    'payment:'||p_payment_id::text, p_admin,
    jsonb_build_object('amount_bdt', v_payment.amount, 'limit_amount_usd', v_usd)
  );

  RETURN jsonb_build_object(
    'already', false,
    'system_limit_before', v_limit_before,
    'system_limit_after', v_limit_after,
    'usd_delta', v_usd
  );
END $$;

-- ============================================================
-- 4) Manual adjust system limit
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_tenant_system_limit(
  p_tenant_id uuid,
  p_mode text,           -- 'increase' | 'decrease' | 'set'
  p_amount numeric,
  p_reason text,
  p_admin uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_limit_before numeric; v_used_before numeric;
  v_limit_after  numeric; v_delta numeric;
  v_payment_id uuid;
  v_movement text;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'amount must be >= 0'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'reason required'; END IF;
  IF p_mode NOT IN ('increase','decrease','set') THEN RAISE EXCEPTION 'invalid mode'; END IF;

  SELECT system_limit, total_used INTO v_limit_before, v_used_before
    FROM public.tenants WHERE id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found'; END IF;

  IF p_mode = 'increase' THEN
    v_limit_after := COALESCE(v_limit_before,0) + p_amount;
    v_movement := 'limit_manual_increase';
  ELSIF p_mode = 'decrease' THEN
    v_limit_after := GREATEST(0, COALESCE(v_limit_before,0) - p_amount);
    v_movement := 'limit_manual_decrease';
  ELSE
    v_limit_after := p_amount;
    v_movement := 'limit_set';
  END IF;

  v_delta := v_limit_after - COALESCE(v_limit_before,0);

  UPDATE public.tenants
     SET system_limit = v_limit_after,
         subscription_type = 'subscription_with_limit',
         updated_at = now()
   WHERE id = p_tenant_id;

  INSERT INTO public.tenant_payments
    (tenant_id, amount, limit_amount, payment_type, status, adjustment_reason, reviewed_by)
  VALUES
    (p_tenant_id, 0, v_delta, 'manual_adjustment', 'approved', p_reason, p_admin)
  RETURNING id INTO v_payment_id;

  PERFORM public._tll_insert(
    p_tenant_id, v_movement, v_delta,
    v_limit_before, v_limit_after,
    v_used_before, v_used_before,
    p_reason,
    'manual_adjustment', v_payment_id::text,
    'adjust:'||v_payment_id::text, p_admin, NULL
  );

  RETURN jsonb_build_object(
    'system_limit_before', v_limit_before,
    'system_limit_after', v_limit_after,
    'delta', v_delta,
    'payment_id', v_payment_id
  );
END $$;

-- ============================================================
-- 5) Manual refund of total_used (reduces usage)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refund_tenant_usage(
  p_tenant_id uuid,
  p_amount numeric,
  p_reason text,
  p_admin uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_limit numeric; v_used_before numeric; v_used_after numeric;
  v_idem text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION 'reason required'; END IF;

  SELECT system_limit, total_used INTO v_limit, v_used_before
    FROM public.tenants WHERE id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found'; END IF;

  v_used_after := GREATEST(0, COALESCE(v_used_before,0) - p_amount);

  UPDATE public.tenants
     SET total_used = v_used_after,
         updated_at = now()
   WHERE id = p_tenant_id;

  v_idem := 'manual_refund:'||gen_random_uuid()::text;

  INSERT INTO public.tenant_usage_report_keys
    (tenant_id, idempotency_key, action, amount, source, meta,
     before_total_used, after_total_used)
  VALUES
    (p_tenant_id, v_idem, 'refund-usage', p_amount, 'master:manual_refund',
     jsonb_build_object('reason', p_reason, 'admin', p_admin),
     v_used_before, v_used_after);

  PERFORM public._tll_insert(
    p_tenant_id, 'usage_refund', -p_amount,
    v_limit, v_limit,
    v_used_before, v_used_after,
    p_reason, 'manual_refund', NULL, v_idem, p_admin, NULL
  );

  RETURN jsonb_build_object(
    'total_used_before', v_used_before,
    'total_used_after', v_used_after,
    'system_limit', v_limit
  );
END $$;

-- ============================================================
-- 6) Update apply_tenant_usage to also write ledger
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_tenant_usage(
  p_tenant_id uuid,
  p_amount numeric,
  p_action text,
  p_key text,
  p_source text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_inserted int;
  v_before numeric; v_after numeric; v_limit numeric;
  v_delta numeric; v_audit_id uuid;
  v_effective_key text;
  v_movement text;
BEGIN
  IF p_action NOT IN ('report-usage','refund-usage') THEN
    RAISE EXCEPTION 'invalid action %', p_action;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  IF p_key IS NOT NULL AND length(trim(p_key)) > 0 THEN
    v_effective_key := p_key;
    INSERT INTO public.tenant_usage_report_keys
      (tenant_id, idempotency_key, action, amount, source, meta)
    VALUES
      (p_tenant_id, v_effective_key, p_action, p_amount, p_source, p_meta)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_audit_id;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
      SELECT total_used, system_limit INTO v_before, v_limit
      FROM public.tenants WHERE id=p_tenant_id;
      RETURN jsonb_build_object('duplicate', true,
        'total_used', COALESCE(v_before,0), 'system_limit', v_limit);
    END IF;
  ELSE
    v_effective_key := 'nokey:'||gen_random_uuid()::text;
    INSERT INTO public.tenant_usage_report_keys
      (tenant_id, idempotency_key, action, amount, source, meta)
    VALUES
      (p_tenant_id, v_effective_key, p_action, p_amount, p_source, p_meta)
    RETURNING id INTO v_audit_id;
  END IF;

  v_delta := CASE WHEN p_action='report-usage' THEN p_amount ELSE -p_amount END;
  v_movement := CASE WHEN p_action='report-usage' THEN 'usage_topup' ELSE 'usage_refund' END;

  UPDATE public.tenants
     SET total_used = GREATEST(0, COALESCE(total_used,0) + v_delta),
         updated_at = now()
   WHERE id = p_tenant_id
  RETURNING (COALESCE(total_used,0) - v_delta), total_used, system_limit
       INTO v_before, v_after, v_limit;

  UPDATE public.tenant_usage_report_keys
     SET before_total_used=v_before, after_total_used=v_after
   WHERE id = v_audit_id;

  PERFORM public._tll_insert(
    p_tenant_id, v_movement, v_delta,
    v_limit, v_limit,
    v_before, v_after,
    NULLIF(coalesce((p_meta->>'reason'),''),''),
    p_source, NULLIF(coalesce((p_meta->>'ad_account_id'),''),''),
    v_effective_key, NULL, p_meta
  );

  RETURN jsonb_build_object(
    'duplicate', false,
    'total_used', v_after,
    'system_limit', v_limit,
    'before_total_used', v_before,
    'after_total_used', v_after
  );
END $$;

-- ============================================================
-- 7) Backfill ledger from existing approved data (one-time, idempotent)
-- ============================================================
INSERT INTO public.tenant_limit_ledger
  (tenant_id, movement_type, amount_delta,
   system_limit_before, system_limit_after,
   total_used_before, total_used_after,
   remaining_before, remaining_after,
   reason, source, source_id, idempotency_key, created_at, meta)
SELECT
  tp.tenant_id,
  CASE WHEN tp.payment_type='limit_purchase' THEN 'limit_purchase'
       WHEN COALESCE(tp.limit_amount,0) >= 0 THEN 'limit_manual_increase'
       ELSE 'limit_manual_decrease' END,
  COALESCE(tp.limit_amount,0),
  NULL, NULL, NULL, NULL, NULL, NULL,
  COALESCE(tp.adjustment_reason, 'backfill'),
  'tenant_payments', tp.id::text,
  'backfill:payment:'||tp.id::text,
  tp.created_at,
  jsonb_build_object('amount_bdt', tp.amount)
FROM public.tenant_payments tp
WHERE tp.status='approved'
  AND COALESCE(tp.limit_amount,0) <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.tenant_limit_ledger l
     WHERE l.idempotency_key='backfill:payment:'||tp.id::text
  );

INSERT INTO public.tenant_limit_ledger
  (tenant_id, movement_type, amount_delta,
   system_limit_before, system_limit_after,
   total_used_before, total_used_after,
   remaining_before, remaining_after,
   reason, source, source_id, idempotency_key, created_at, meta)
SELECT
  k.tenant_id,
  CASE WHEN k.action='report-usage' THEN 'usage_topup' ELSE 'usage_refund' END,
  CASE WHEN k.action='report-usage' THEN k.amount ELSE -k.amount END,
  NULL, NULL,
  k.before_total_used, k.after_total_used,
  NULL, NULL,
  COALESCE(k.meta->>'reason', NULL),
  COALESCE(k.source, 'backfill'),
  k.idempotency_key, 'backfill:usage:'||k.id::text,
  k.created_at, k.meta
FROM public.tenant_usage_report_keys k
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_limit_ledger l
   WHERE l.idempotency_key='backfill:usage:'||k.id::text
);
