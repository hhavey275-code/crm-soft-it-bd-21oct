DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_agency_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_id_by_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_vault_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_tenant_system_limit(uuid, text, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_wallet_atomic(uuid, numeric, text, text, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_secondary_wallet(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_convert_main_to_secondary(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_global_rate_delta(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_client_topup_atomic(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_tenant_limit_payment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_referral(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_missing_approved_topup(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet_for_payment(uuid, numeric, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_ledger_entry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.money_health_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_referral_earnings(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_tenant_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_tenant_total_used(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_available_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_tenant_usage(uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_wallet_balance(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_referral_payout(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_referral_payout(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.topup_requests_mirrored(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ledger_entry(uuid, numeric, text, text) TO authenticated;