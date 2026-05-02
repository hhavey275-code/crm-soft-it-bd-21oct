
CREATE OR REPLACE FUNCTION public.trigger_sheet_sync_on_seller_txn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only fire for approved transactions
  IF NEW.status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only fire when status transitions into 'approved'
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://dhswrfzdqcavgmymllat.supabase.co/functions/v1/sync-seller-to-sheet',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s"}'::jsonb,
      body := jsonb_build_object('seller_transaction_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sheet sync trigger failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sheet_sync_on_seller_txn_ins ON public.seller_transactions;
CREATE TRIGGER sheet_sync_on_seller_txn_ins
  AFTER INSERT ON public.seller_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_sheet_sync_on_seller_txn();

DROP TRIGGER IF EXISTS sheet_sync_on_seller_txn_upd ON public.seller_transactions;
CREATE TRIGGER sheet_sync_on_seller_txn_upd
  AFTER UPDATE OF status ON public.seller_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_sheet_sync_on_seller_txn();
