-- Fix apply_tenant_usage to properly save before_total_used and after_total_used.
-- Bug: in the no-key branch, the WHERE clause used a freshly generated UUID
-- that differed from the one inserted, so the UPDATE never matched any row
-- and before/after stayed NULL.

CREATE OR REPLACE FUNCTION public.apply_tenant_usage(
  p_tenant_id uuid,
  p_amount numeric,
  p_action text,
  p_key text,
  p_source text DEFAULT NULL::text,
  p_meta jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int;
  v_before numeric;
  v_after numeric;
  v_limit numeric;
  v_delta numeric;
  v_audit_id uuid;
  v_effective_key text;
BEGIN
  IF p_action NOT IN ('report-usage','refund-usage') THEN
    RAISE EXCEPTION 'invalid action %', p_action;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  -- Determine the effective idempotency key (caller's key, or a fresh nokey)
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
      FROM public.tenants WHERE id = p_tenant_id;
      RETURN jsonb_build_object(
        'duplicate', true,
        'total_used', COALESCE(v_before, 0),
        'system_limit', v_limit
      );
    END IF;
  ELSE
    v_effective_key := 'nokey:' || gen_random_uuid()::text;
    INSERT INTO public.tenant_usage_report_keys
      (tenant_id, idempotency_key, action, amount, source, meta)
    VALUES
      (p_tenant_id, v_effective_key, p_action, p_amount, p_source, p_meta)
    RETURNING id INTO v_audit_id;
  END IF;

  v_delta := CASE WHEN p_action = 'report-usage' THEN p_amount ELSE -p_amount END;

  -- Atomic tenants update with row lock
  UPDATE public.tenants
     SET total_used = GREATEST(0, COALESCE(total_used, 0) + v_delta),
         updated_at = now()
   WHERE id = p_tenant_id
  RETURNING (COALESCE(total_used, 0) - v_delta), total_used, system_limit
       INTO v_before, v_after, v_limit;

  -- Update audit row with before/after using the EXACT id from insert
  UPDATE public.tenant_usage_report_keys
     SET before_total_used = v_before,
         after_total_used = v_after
   WHERE id = v_audit_id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'total_used', v_after,
    'system_limit', v_limit,
    'before_total_used', v_before,
    'after_total_used', v_after
  );
END;
$function$;

-- Reconcile tenant master total_used to a known correct value (from tenant DB).
-- Logs the adjustment in the audit log and returns the new state.
CREATE OR REPLACE FUNCTION public.reconcile_tenant_total_used(
  p_tenant_id uuid,
  p_new_total_used numeric,
  p_reason text DEFAULT 'manual reconcile'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_before numeric;
  v_after numeric;
  v_limit numeric;
  v_delta numeric;
BEGIN
  IF p_new_total_used IS NULL OR p_new_total_used < 0 THEN
    RAISE EXCEPTION 'new total_used must be >= 0';
  END IF;

  SELECT total_used, system_limit INTO v_before, v_limit
  FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found';
  END IF;

  v_after := p_new_total_used;
  v_delta := v_after - COALESCE(v_before, 0);

  UPDATE public.tenants
     SET total_used = v_after,
         updated_at = now()
   WHERE id = p_tenant_id;

  -- Insert an audit row so it shows in the Usage Log
  INSERT INTO public.tenant_usage_report_keys
    (tenant_id, idempotency_key, action, amount, source, meta,
     before_total_used, after_total_used)
  VALUES
    (p_tenant_id,
     'reconcile:' || gen_random_uuid()::text,
     CASE WHEN v_delta >= 0 THEN 'report-usage' ELSE 'refund-usage' END,
     ABS(v_delta),
     'master:reconcile',
     jsonb_build_object('reason', p_reason, 'manual_adjust', true),
     v_before,
     v_after);

  RETURN jsonb_build_object(
    'before_total_used', v_before,
    'after_total_used', v_after,
    'delta', v_delta,
    'system_limit', v_limit
  );
END;
$function$;