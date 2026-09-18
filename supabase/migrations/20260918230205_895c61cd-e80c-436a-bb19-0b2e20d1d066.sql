CREATE OR REPLACE FUNCTION public.trigger_whatsapp_on_wallet_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'top_up'
     AND COALESCE(NEW.amount, 0) > 0
     AND COALESCE(NEW.wallet_kind, 'primary') = 'primary' THEN
    BEGIN
      PERFORM public.wa_enqueue(
        NEW.user_id,
        'topup_approved',
        jsonb_build_object(
          'amount', '$' || to_char(COALESCE(NEW.amount, 0), 'FM999999990.00'),
          'balance', '$' || to_char(COALESCE(NEW.balance_after, 0), 'FM999999990.00')
        ),
        'topup_approved:' || NEW.id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'wa enqueue failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;