CREATE OR REPLACE FUNCTION public.topup_requests_mirrored(p_ids uuid[])
RETURNS TABLE(top_up_request_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT st.top_up_request_id
  FROM public.seller_transactions st
  WHERE st.top_up_request_id = ANY(p_ids)
    AND st.status <> 'rejected';
$$;

GRANT EXECUTE ON FUNCTION public.topup_requests_mirrored(uuid[]) TO authenticated;