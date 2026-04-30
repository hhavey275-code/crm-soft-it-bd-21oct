ALTER TABLE public.top_up_requests
  ADD COLUMN IF NOT EXISTS telegram_forwarding_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS telegram_forwarded_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS telegram_forward_error text;

CREATE INDEX IF NOT EXISTS idx_top_up_requests_telegram_forwarding
  ON public.top_up_requests (status, telegram_forwarded, telegram_forwarding_started_at)
  WHERE proof_url IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_topup_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.type = 'top_up' AND NEW.reference_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.type = 'top_up'
        AND t.reference_id = NEW.reference_id
    ) THEN
      RAISE EXCEPTION 'Duplicate top-up credit blocked for request %', NEW.reference_id
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_topup_credit_trigger ON public.transactions;
CREATE TRIGGER prevent_duplicate_topup_credit_trigger
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_topup_credit();

CREATE OR REPLACE FUNCTION public.prevent_duplicate_topup_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.top_up_request_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.top_up_request_id = NEW.top_up_request_id
    ) THEN
      RAISE EXCEPTION 'Duplicate invoice blocked for top-up request %', NEW.top_up_request_id
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_topup_invoice_trigger ON public.invoices;
CREATE TRIGGER prevent_duplicate_topup_invoice_trigger
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_topup_invoice();

CREATE OR REPLACE FUNCTION public.sync_seller_transaction_for_approved_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      seller_id,
      type,
      bdt_amount,
      usdt_amount,
      rate,
      description,
      bank_account_id,
      top_up_request_id,
      proof_url,
      status,
      reviewed_by,
      reviewed_at,
      entry_by_name
    ) VALUES (
      v_seller_id,
      'client_topup',
      COALESCE(NEW.bdt_amount, 0),
      0,
      0,
      'Client top-up approved — $' || COALESCE(NEW.amount, 0),
      NEW.bank_account_id,
      NEW.id,
      NEW.proof_url,
      'approved',
      NEW.reviewed_by,
      now(),
      COALESCE(v_client_name, 'Client')
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
      status = 'approved',
      reviewed_by = COALESCE(EXCLUDED.reviewed_by, public.seller_transactions.reviewed_by),
      reviewed_at = now(),
      entry_by_name = COALESCE(EXCLUDED.entry_by_name, public.seller_transactions.entry_by_name);
  END IF;

  IF (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.proof_url IS NOT NULL
     AND v_group_id IS NOT NULL
     AND COALESCE(NEW.telegram_forwarded, false) = false THEN
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
$$;

DROP TRIGGER IF EXISTS sync_seller_transaction_for_approved_topup_trigger ON public.top_up_requests;
CREATE TRIGGER sync_seller_transaction_for_approved_topup_trigger
  AFTER INSERT OR UPDATE ON public.top_up_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_seller_transaction_for_approved_topup();