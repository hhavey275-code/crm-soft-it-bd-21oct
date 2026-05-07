DO $$
DECLARE
  r record;
  v_before numeric;
  v_after numeric;
BEGIN
  FOR r IN
    SELECT tp.id, tp.tenant_id, tp.limit_amount, tp.amount,
           COALESCE(tp.updated_at, tp.created_at) AS approved_at
      FROM public.tenant_payments tp
     WHERE tp.status = 'approved'
       AND tp.payment_type = 'limit_purchase'
       AND COALESCE(tp.limit_amount, 0) <> 0
       AND NOT EXISTS (
         SELECT 1 FROM public.tenant_limit_ledger l
          WHERE l.source = 'tenant_payments' AND l.source_id = tp.id::text
       )
     ORDER BY COALESCE(tp.updated_at, tp.created_at) ASC
  LOOP
    SELECT system_limit_after INTO v_before
      FROM public.tenant_limit_ledger
     WHERE tenant_id = r.tenant_id
       AND created_at <= r.approved_at
       AND system_limit_after IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_before IS NULL THEN
      SELECT system_limit_before INTO v_before
        FROM public.tenant_limit_ledger
       WHERE tenant_id = r.tenant_id
         AND created_at >= r.approved_at
         AND system_limit_before IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 1;
      IF v_before IS NOT NULL THEN
        v_before := v_before - r.limit_amount;
      END IF;
    END IF;

    v_before := COALESCE(v_before, 0);
    v_after  := v_before + r.limit_amount;

    INSERT INTO public.tenant_limit_ledger
      (tenant_id, movement_type, amount_delta,
       system_limit_before, system_limit_after,
       total_used_before, total_used_after,
       remaining_before, remaining_after,
       reason, source, source_id, idempotency_key, created_at, meta)
    VALUES
      (r.tenant_id, 'limit_purchase', r.limit_amount,
       v_before, v_after,
       NULL, NULL,
       NULL, NULL,
       'Backfilled limit_purchase payment',
       'tenant_payments', r.id::text,
       'payment:'||r.id::text,
       r.approved_at,
       jsonb_build_object('amount_bdt', r.amount, 'limit_amount_usd', r.limit_amount, 'backfilled', true));
  END LOOP;
END $$;