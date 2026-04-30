-- Fix seller ledger rows that were still pending even after the linked client top-up was approved.
UPDATE public.seller_transactions st
SET status = 'approved',
    reviewed_at = COALESCE(st.reviewed_at, now()),
    admin_note = trim(both ' ' from COALESCE(st.admin_note, '') || ' [Auto-fix: linked approved top-up was stuck pending]')
FROM public.top_up_requests tur
WHERE st.top_up_request_id = tur.id
  AND tur.status = 'approved'
  AND st.status = 'pending';

-- Ignore duplicate active seller ledger rows for the same top-up, keeping the earliest row.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY top_up_request_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.seller_transactions
  WHERE top_up_request_id IS NOT NULL
    AND status <> 'rejected'
)
UPDATE public.seller_transactions st
SET status = 'rejected',
    reviewed_at = COALESCE(st.reviewed_at, now()),
    admin_note = trim(both ' ' from COALESCE(st.admin_note, '') || ' [Auto-fix: duplicate top-up ledger row ignored]')
FROM ranked r
WHERE st.id = r.id
  AND r.rn > 1;

-- Prevent future duplicate active ledger rows for the same top-up.
CREATE UNIQUE INDEX IF NOT EXISTS seller_transactions_one_active_topup_idx
ON public.seller_transactions (top_up_request_id)
WHERE top_up_request_id IS NOT NULL
  AND status <> 'rejected';