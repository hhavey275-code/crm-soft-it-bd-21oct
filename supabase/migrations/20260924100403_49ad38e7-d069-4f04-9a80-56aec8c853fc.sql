REVOKE EXECUTE ON FUNCTION public.ext_topup_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ext_topup_on_cap_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_mark_external_topup_manual(uuid, numeric, text) FROM PUBLIC, anon;