REVOKE EXECUTE ON FUNCTION public.get_profile_stock() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_profile_stock() TO authenticated;