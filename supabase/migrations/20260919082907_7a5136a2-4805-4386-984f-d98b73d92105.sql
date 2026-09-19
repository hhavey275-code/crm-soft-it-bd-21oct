REVOKE ALL ON FUNCTION public.admin_adjust_credit_line_wallet(uuid, numeric, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_convert_main_to_credit_line(uuid, numeric, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.ensure_credit_line_funds(uuid, numeric, text, boolean, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credit_line_wallet(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_convert_main_to_credit_line(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_credit_line_funds(uuid, numeric, text, boolean, numeric) TO authenticated, service_role;