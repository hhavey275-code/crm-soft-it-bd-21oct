INSERT INTO public.seller_transactions
  (seller_id, type, bdt_amount, usdt_amount, rate, description, bank_account_id, tenant_payment_id, proof_url, status, reviewed_by, reviewed_at, entry_by_name, created_at)
SELECT
  ba.seller_id,
  'tenant_payment',
  tp.amount,
  0,
  0,
  'Tenant payment approved — ' || COALESCE(t.name, 'Tenant') || ' (' || COALESCE(tp.payment_type, 'payment') || ') [backfill]',
  tp.bank_account_id,
  tp.id,
  tp.proof_url,
  'approved',
  tp.reviewed_by,
  COALESCE(tp.updated_at, tp.created_at),
  'Tenant: ' || COALESCE(t.name, 'Unknown'),
  tp.created_at
FROM public.tenant_payments tp
JOIN public.bank_accounts ba ON ba.id = tp.bank_account_id
LEFT JOIN public.tenants t ON t.id = tp.tenant_id
LEFT JOIN public.seller_transactions st ON st.tenant_payment_id = tp.id
WHERE tp.status = 'approved'
  AND ba.seller_id IS NOT NULL
  AND tp.amount > 0
  AND st.id IS NULL;