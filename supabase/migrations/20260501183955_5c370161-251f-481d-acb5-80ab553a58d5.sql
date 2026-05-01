UPDATE public.seller_transactions st
SET created_at = tur.created_at,
    description = replace(st.description, ' (backfill)', '')
FROM public.top_up_requests tur
WHERE st.top_up_request_id = tur.id
  AND st.type = 'client_topup'
  AND st.description ILIKE '%backfill%';