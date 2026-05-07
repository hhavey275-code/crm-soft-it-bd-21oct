
-- Remove the bogus $233.46 ledger entry that came from tenant's stale function
DELETE FROM public.tenant_limit_ledger WHERE id='b2a2ec0b-3f8e-4326-8000-9cfa967d72e4';
DELETE FROM public.tenant_usage_report_keys WHERE idempotency_key='nokey:d4366f50-a682-4984-8dd9-329e6b8b85e3';

-- Recalc tenant total_used from ledger
WITH agg AS (
  SELECT
    SUM(CASE WHEN movement_type='usage_topup' THEN amount_delta
             WHEN movement_type='usage_refund' THEN -amount_delta
             ELSE 0 END) AS used,
    SUM(CASE WHEN movement_type IN ('limit_purchase','limit_manual_increase') THEN amount_delta
             WHEN movement_type='limit_manual_decrease' THEN -ABS(amount_delta)
             ELSE 0 END) AS limit_delta,
    MAX(CASE WHEN movement_type='limit_set' THEN amount_delta END) AS limit_set
  FROM public.tenant_limit_ledger
  WHERE tenant_id='088158d0-af15-48cf-ac8c-11a8f70c2ef1'
)
UPDATE public.tenants t
   SET total_used = GREATEST(0, COALESCE((SELECT used FROM agg),0)),
       system_limit = COALESCE((SELECT limit_set FROM agg),0) + COALESCE((SELECT limit_delta FROM agg),0),
       updated_at = now()
 WHERE t.id='088158d0-af15-48cf-ac8c-11a8f70c2ef1';
