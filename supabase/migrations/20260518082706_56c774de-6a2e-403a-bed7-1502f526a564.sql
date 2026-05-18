INSERT INTO public.seller_transactions (
  id,
  seller_id,
  type,
  bdt_amount,
  usdt_amount,
  rate,
  description,
  bank_account_id,
  tenant_payment_id,
  proof_url,
  status,
  reviewed_by,
  reviewed_at,
  entry_by_name,
  telegram_forwarded
)
SELECT
  '2f47f63c-1722-4ea9-9325-65b141dde885'::uuid,
  ba.seller_id,
  'tenant_payment',
  tp.amount,
  0,
  0,
  'Tenant payment approved — ' || COALESCE(t.name, 'Tenant') || ' (' || COALESCE(tp.payment_type, 'payment') || ')',
  tp.bank_account_id,
  tp.id,
  tp.proof_url,
  'approved',
  tp.reviewed_by,
  COALESCE(tp.updated_at, now()),
  'Tenant: ' || COALESCE(t.name, 'Unknown'),
  false
FROM public.tenant_payments tp
JOIN public.bank_accounts ba ON ba.id = tp.bank_account_id
LEFT JOIN public.tenants t ON t.id = tp.tenant_id
WHERE tp.id = '6ff2afee-25b9-45d7-b3ec-1abd6c72d292'::uuid
  AND tp.status = 'approved'
  AND ba.seller_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;