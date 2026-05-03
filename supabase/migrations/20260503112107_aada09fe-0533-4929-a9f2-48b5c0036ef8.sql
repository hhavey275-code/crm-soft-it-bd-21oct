-- Extend tenant_usage_report_keys to be a real audit log
ALTER TABLE public.tenant_usage_report_keys
  ADD COLUMN IF NOT EXISTS before_total_used numeric,
  ADD COLUMN IF NOT EXISTS after_total_used numeric,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS meta jsonb;

-- Atomic tenant usage application (idempotent + audited)
CREATE OR REPLACE FUNCTION public.apply_tenant_usage(
  p_tenant_id uuid,
  p_amount numeric,
  p_action text,
  p_key text,
  p_source text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
  v_before numeric;
  v_after numeric;
  v_limit numeric;
  v_delta numeric;
BEGIN
  IF p_action NOT IN ('report-usage','refund-usage') THEN
    RAISE EXCEPTION 'invalid action %', p_action;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  -- Try to claim the idempotency key first
  IF p_key IS NOT NULL AND length(trim(p_key)) > 0 THEN
    INSERT INTO public.tenant_usage_report_keys
      (tenant_id, idempotency_key, action, amount, source, meta)
    VALUES
      (p_tenant_id, p_key, p_action, p_amount, p_source, p_meta)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
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
    INSERT INTO public.tenant_usage_report_keys
      (tenant_id, idempotency_key, action, amount, source, meta)
    VALUES
      (p_tenant_id, 'nokey:' || gen_random_uuid()::text, p_action, p_amount, p_source, p_meta);
  END IF;

  v_delta := CASE WHEN p_action = 'report-usage' THEN p_amount ELSE -p_amount END;

  -- Atomic tenants update with row lock
  UPDATE public.tenants
     SET total_used = GREATEST(0, COALESCE(total_used, 0) + v_delta),
         updated_at = now()
   WHERE id = p_tenant_id
  RETURNING (COALESCE(total_used, 0) - v_delta), total_used, system_limit
       INTO v_before, v_after, v_limit;

  -- Update audit row with before/after
  UPDATE public.tenant_usage_report_keys
     SET before_total_used = v_before,
         after_total_used = v_after
   WHERE tenant_id = p_tenant_id
     AND idempotency_key = COALESCE(NULLIF(p_key,''), 'nokey:' || gen_random_uuid()::text)
     AND created_at > now() - interval '1 minute';

  RETURN jsonb_build_object(
    'duplicate', false,
    'total_used', v_after,
    'system_limit', v_limit,
    'before_total_used', v_before,
    'after_total_used', v_after
  );
END;
$$;

-- One-off correction for Scale Up tenant (master used was drifting upward)
DO $$
DECLARE
  v_before numeric;
BEGIN
  SELECT total_used INTO v_before FROM public.tenants
   WHERE id = '088158d0-af15-48cf-ac8c-11a8f70c2ef1';
  UPDATE public.tenants
     SET total_used = 5639.00,
         updated_at = now()
   WHERE id = '088158d0-af15-48cf-ac8c-11a8f70c2ef1';
  INSERT INTO public.tenant_usage_report_keys
    (tenant_id, idempotency_key, action, amount, source, meta, before_total_used, after_total_used)
  VALUES (
    '088158d0-af15-48cf-ac8c-11a8f70c2ef1',
    'manual-correction:' || to_char(now(), 'YYYYMMDDHH24MISS'),
    'refund-usage',
    GREATEST(0, COALESCE(v_before,0) - 5639.00),
    'manual_correction',
    jsonb_build_object('reason', 'Align master total_used with tenant local log (was 6473.68, set to 5639.00)'),
    v_before,
    5639.00
  );
END$$;