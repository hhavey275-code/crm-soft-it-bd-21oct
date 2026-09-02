REVOKE ALL ON FUNCTION public.set_referral_code_on_profile() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.gen_referral_code() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gen_referral_code() TO service_role;