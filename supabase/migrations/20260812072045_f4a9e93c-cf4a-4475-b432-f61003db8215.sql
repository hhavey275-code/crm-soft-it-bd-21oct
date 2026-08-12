CREATE OR REPLACE FUNCTION public.trigger_whatsapp_on_wallet_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'top_up' AND COALESCE(NEW.amount, 0) > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://project--4071fb47-3fb7-470b-8dc6-c1e98bcdea65-dev.lovable.app/api/public/whatsapp-notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Notify-Secret', '482c724471f1c4cb61b6a1db3386dddd031e223158fd41c8'
        ),
        body := jsonb_build_object(
          'user_id', NEW.user_id,
          'amount', NEW.amount,
          'balance_after', NEW.balance_after
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'WhatsApp topup notify failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_on_wallet_topup ON public.transactions;
CREATE TRIGGER whatsapp_on_wallet_topup
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trigger_whatsapp_on_wallet_topup();