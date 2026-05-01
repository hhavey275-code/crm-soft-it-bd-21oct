
-- Backfill missing seller_transactions for approved+telegram-forwarded top-ups
-- where the receiving bank already has a seller assigned, but the trigger
-- never inserted the corresponding ledger row.
INSERT INTO public.seller_transactions (
  seller_id, type, bdt_amount, usdt_amount, rate, description,
  bank_account_id, top_up_request_id, proof_url, created_at,
  status, reviewed_by, reviewed_at, entry_by_name
)
SELECT
  ba.seller_id,
  'client_topup',
  COALESCE(t.bdt_amount, 0),
  0, 0,
  'Client top-up approved — $' || COALESCE(t.amount, 0)::text || ' (backfilled)',
  t.bank_account_id,
  t.id,
  t.proof_url,
  t.created_at,
  'approved',
  t.reviewed_by,
  now(),
  COALESCE(NULLIF(p.full_name, ''), p.email, 'Client')
FROM public.top_up_requests t
JOIN public.bank_accounts ba ON ba.id = t.bank_account_id
LEFT JOIN public.profiles p ON p.user_id = t.user_id
LEFT JOIN public.seller_transactions st ON st.top_up_request_id = t.id
WHERE t.status = 'approved'
  AND t.telegram_forwarded = true
  AND st.id IS NULL
  AND ba.seller_id IS NOT NULL;
