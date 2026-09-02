GRANT SELECT, INSERT, UPDATE, DELETE ON public.spend_cap_withdraw_requests TO authenticated;
GRANT ALL ON public.spend_cap_withdraw_requests TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.spend_cap_withdraw_requests;

CREATE OR REPLACE FUNCTION public.notify_admins_on_spend_cap_withdraw_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_account text;
BEGIN
  SELECT COALESCE(full_name, email, 'Client') INTO v_name FROM public.profiles WHERE user_id = NEW.user_id;
  SELECT COALESCE(account_name, 'Ad account') INTO v_account FROM public.ad_accounts WHERE id = NEW.ad_account_id;

  INSERT INTO public.notifications (user_id, type, title, message, reference_id)
  SELECT ur.user_id,
         'spend_cap_withdraw_request',
         'Balance Withdraw Request',
         COALESCE(v_name, 'Client') || ' requested $' || to_char(NEW.amount_usd, 'FM999999990.00') ||
         ' withdraw from ' || COALESCE(v_account, 'an ad account') ||
         COALESCE(' — ' || NEW.note, ''),
         NEW.id
  FROM public.user_roles ur
  WHERE ur.role IN ('admin', 'superadmin');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_admins_on_spend_cap_withdraw_request_trg ON public.spend_cap_withdraw_requests;
CREATE TRIGGER notify_admins_on_spend_cap_withdraw_request_trg
AFTER INSERT ON public.spend_cap_withdraw_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_admins_on_spend_cap_withdraw_request();