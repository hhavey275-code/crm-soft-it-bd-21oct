-- Najmul Hossen: remove duplicate carry-forward row.
-- The Forwarded archive migration already brought the manual bdt_payment / tenant_payment
-- rows into the live ledger as client_topup, so the auto-generated April carry-forward
-- (৳6,146,377) is now double-counting. Delete it.
DELETE FROM public.seller_transactions
WHERE id = 'b122c1cf-5cf9-4d8c-a9c6-c7c7d13e4f61'
  AND seller_id = 'e5670168-73b0-4f07-a6a4-3a033ab9bb1b'
  AND type = 'bdt_payment'
  AND description = 'Previous month carry forward (April 2026 closing balance)';