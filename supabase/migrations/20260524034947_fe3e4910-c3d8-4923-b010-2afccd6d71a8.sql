CREATE OR REPLACE FUNCTION public.reconcile_tenant_total_used(p_tenant_id uuid, p_new_total_used numeric, p_reason text DEFAULT 'manual reconcile'::text)
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
  v_idem text;
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
  v_idem := 'reconcile:' || gen_random_uuid()::text;

  UPDATE public.tenants
     SET total_used = v_after,
         updated_at = now()
   WHERE id = p_tenant_id;

  INSERT INTO public.tenant_usage_report_keys
    (tenant_id, idempotency_key, action, amount, source, meta,
     before_total_used, after_total_used)
  VALUES
    (p_tenant_id,
     v_idem,
     CASE WHEN v_delta >= 0 THEN 'report-usage' ELSE 'refund-usage' END,
     ABS(v_delta),
     'master:reconcile',
     jsonb_build_object('reason', p_reason, 'manual_adjust', true),
     v_before,
     v_after);

  -- Also write to master limit ledger so admin/tenant logs show this movement
  IF v_delta <> 0 THEN
    PERFORM public._tll_insert(
      p_tenant_id,
      CASE WHEN v_delta >= 0 THEN 'usage_topup' ELSE 'usage_refund' END,
      v_delta,
      v_limit, v_limit,
      COALESCE(v_before,0), v_after,
      p_reason,
      'master:reconcile', NULL,
      v_idem, NULL,
      jsonb_build_object('reason', p_reason, 'manual_adjust', true)
    );
  END IF;

  RETURN jsonb_build_object(
    'before_total_used', v_before,
    'after_total_used', v_after,
    'delta', v_delta,
    'system_limit', v_limit
  );
END;
$function$;