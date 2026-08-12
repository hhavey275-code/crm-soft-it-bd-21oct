REVOKE EXECUTE ON FUNCTION public.approve_client_topup_atomic(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_client_topup_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_client_topup_atomic(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_client_topup_atomic(uuid, uuid) TO service_role;