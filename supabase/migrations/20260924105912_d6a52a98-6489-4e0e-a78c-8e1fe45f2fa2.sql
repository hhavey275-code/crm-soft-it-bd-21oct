CREATE OR REPLACE FUNCTION public.ext_topup_on_cap_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.spend_cap IS NOT NULL THEN
    UPDATE external_topup_requests SET spend_cap_after = NEW.spend_cap, limit_status = 'updated'
    WHERE ad_account_id = NEW.id AND limit_status IN ('pending','not_updated')
      AND refunded_at IS NULL AND status <> 'rejected'
      AND created_at > now() - interval '3 days'
      AND spend_cap_before IS NOT NULL AND spend_cap_before < NEW.spend_cap;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ext_topup_on_cap_change ON public.ad_accounts;
CREATE TRIGGER trg_ext_topup_on_cap_change AFTER UPDATE ON public.ad_accounts
FOR EACH ROW EXECUTE FUNCTION public.ext_topup_on_cap_change();