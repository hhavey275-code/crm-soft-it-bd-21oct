-- Insert baseline opening balance entries
INSERT INTO public.tenant_limit_ledger
  (tenant_id, movement_type, amount_delta,
   system_limit_before, system_limit_after,
   total_used_before, total_used_after,
   remaining_before, remaining_after,
   reason, source, idempotency_key, meta, created_at)
VALUES
  ('088158d0-af15-48cf-ac8c-11a8f70c2ef1', 'limit_set', 9008.12,
   0, 9008.12, 0, 0, 0, 9008.12,
   'Opening balance (historical baseline)', 'manual_baseline',
   'baseline:limit:'||gen_random_uuid()::text,
   jsonb_build_object('baseline', true), now() - interval '2 seconds'),
  ('088158d0-af15-48cf-ac8c-11a8f70c2ef1', 'usage_topup', 8139.49,
   9008.12, 9008.12, 0, 8139.49, 9008.12, 868.63,
   'Opening used balance (historical baseline)', 'manual_baseline',
   'baseline:used:'||gen_random_uuid()::text,
   jsonb_build_object('baseline', true), now() - interval '1 second');

-- Restore tenant totals
UPDATE public.tenants
   SET system_limit = 9008.12,
       total_used = 8139.49,
       updated_at = now()
 WHERE id = '088158d0-af15-48cf-ac8c-11a8f70c2ef1';