-- Fix orphan seller_transactions rows that stayed 'pending'
-- even though their linked top_up_request was already approved.
-- These cause the seller ledger Due/Advance running balance to be understated.
UPDATE public.seller_transactions st
SET status = 'approved',
    reviewed_at = COALESCE(st.reviewed_at, now())
FROM public.top_up_requests tur
WHERE st.top_up_request_id = tur.id
  AND st.status = 'pending'
  AND tur.status = 'approved';