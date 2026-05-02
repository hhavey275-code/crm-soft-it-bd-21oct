-- Server-side safety net: auto-invoke forward-seller-proof when a seller_transaction is approved
-- and not yet forwarded. Mirrors the pattern of trigger_telegram_poll_on_topup.

CREATE OR REPLACE FUNCTION public.trigger_forward_seller_txn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only handle approved, not-yet-forwarded, qualifying types
  IF NEW.status IS DISTINCT FROM 'approved' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.telegram_forwarded, false) = true THEN RETURN NEW; END IF;
  IF NEW.type NOT IN ('usdt_received', 'bdt_payment', 'withdraw') THEN RETURN NEW; END IF;

  -- On UPDATE, only fire when transitioning into approved (not on every later edit)
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN RETURN NEW; END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://dhswrfzdqcavgmymllat.supabase.co/functions/v1/forward-seller-proof',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s"}'::jsonb,
      body := jsonb_build_object(
        'seller_transaction_id', NEW.id,
        'payment_kind', NEW.type,
        'proof_url', NEW.proof_url,
        'seller_id', NEW.seller_id,
        'usdt_amount', NEW.usdt_amount,
        'rate', NEW.rate,
        'bdt_amount', NEW.bdt_amount,
        'bank_account_id', NEW.bank_account_id,
        'reference', NEW.description,
        'withdraw_note', CASE WHEN NEW.type = 'withdraw' THEN NEW.description ELSE NULL END
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'forward-seller-proof trigger failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_forward_seller_txn ON public.seller_transactions;
CREATE TRIGGER trg_forward_seller_txn
AFTER INSERT OR UPDATE ON public.seller_transactions
FOR EACH ROW EXECUTE FUNCTION public.trigger_forward_seller_txn();