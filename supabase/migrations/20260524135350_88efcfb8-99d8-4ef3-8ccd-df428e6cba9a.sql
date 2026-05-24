-- Strict-once Telegram forward: the trigger now refuses to invoke forward-proof
-- if the row was previously approved, or if telegram_forwarded is already true.
-- This is on top of the slot-based atomic dedupe in forward-proof itself.
CREATE OR REPLACE FUNCTION public.sync_seller_transaction_for_approved_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_id uuid;
  v_group_id text;
  v_client_name text;
BEGIN
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  IF NEW.bank_account_id IS NOT NULL THEN
    SELECT seller_id, telegram_group_id
      INTO v_seller_id, v_group_id
    FROM public.bank_accounts
    WHERE id = NEW.bank_account_id;
  END IF;

  IF v_seller_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(full_name, ''), email, 'Client')
      INTO v_client_name
    FROM public.profiles
    WHERE user_id = NEW.user_id
    LIMIT 1;

    INSERT INTO public.seller_transactions (
      seller_id, type, bdt_amount, usdt_amount, rate, description,
      bank_account_id, top_up_request_id, proof_url, created_at,
      status, reviewed_by, reviewed_at, entry_by_name
    ) VALUES (
      v_seller_id, 'client_topup', COALESCE(NEW.bdt_amount, 0), 0, 0,
      'Client top-up approved — $' || COALESCE(NEW.amount, 0),
      NEW.bank_account_id, NEW.id, NEW.proof_url, NEW.created_at,
      'approved', NEW.reviewed_by, now(), COALESCE(v_client_name, 'Client')
    )
    ON CONFLICT (top_up_request_id) WHERE top_up_request_id IS NOT NULL AND status <> 'rejected'
    DO UPDATE SET
      seller_id = EXCLUDED.seller_id,
      type = 'client_topup',
      bdt_amount = EXCLUDED.bdt_amount,
      usdt_amount = 0,
      rate = 0,
      description = EXCLUDED.description,
      bank_account_id = EXCLUDED.bank_account_id,
      proof_url = EXCLUDED.proof_url,
      created_at = EXCLUDED.created_at,
      status = 'approved',
      reviewed_by = COALESCE(EXCLUDED.reviewed_by, public.seller_transactions.reviewed_by),
      reviewed_at = now(),
      entry_by_name = COALESCE(EXCLUDED.entry_by_name, public.seller_transactions.entry_by_name);
  END IF;

  -- STRICT FORWARD GUARD:
  --   * fire only on a true transition INTO approved (INSERT with approved,
  --     or UPDATE where OLD.status was NOT approved)
  --   * never fire if telegram_forwarded is already true
  --   * require a configured group and a proof_url
  IF NEW.proof_url IS NOT NULL
     AND v_group_id IS NOT NULL
     AND COALESCE(NEW.telegram_forwarded, false) = false
     AND (
       TG_OP = 'INSERT'
       OR (TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') <> 'approved')
     )
  THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://dhswrfzdqcavgmymllat.supabase.co/functions/v1/forward-proof',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s"}'::jsonb,
        body := jsonb_build_object('request_id', NEW.id)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Top-up Telegram forward trigger failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;