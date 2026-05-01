-- =====================================================
-- Step A: Data integrity hardening
-- 1. Add telegram_forwarded flag + message_id to seller_transactions (idempotency lock)
-- 2. Strengthen purge_rejected_seller_txn to ALSO purge any leftover rejected rows
-- 3. Add a one-time cleanup of any existing rejected rows (defensive)
-- 4. Clean up rejected top_up_requests that should never have been left lying around
--    (we keep top_up_requests history for audit but ensure they NEVER spawn seller_transactions)
-- =====================================================

-- 1. Idempotency columns on seller_transactions
ALTER TABLE public.seller_transactions
  ADD COLUMN IF NOT EXISTS telegram_forwarded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_message_id bigint,
  ADD COLUMN IF NOT EXISTS telegram_forwarded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_seller_txn_tg_forward
  ON public.seller_transactions (id) WHERE telegram_forwarded = true;

-- 2. Defensive cleanup: any rejected seller_transactions row should never persist
DELETE FROM public.seller_transactions WHERE status = 'rejected';

-- 3. Re-affirm the purge trigger (idempotent CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION public.purge_rejected_seller_txn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected' THEN
    DELETE FROM public.seller_transactions WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Make sure the trigger is attached for both INSERT and UPDATE so reject-after-approve also purges
DROP TRIGGER IF EXISTS trg_purge_rejected_seller_txn ON public.seller_transactions;
CREATE TRIGGER trg_purge_rejected_seller_txn
  AFTER INSERT OR UPDATE OF status ON public.seller_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.purge_rejected_seller_txn();

-- 4. Block creating seller_transactions for already-rejected top_up_requests
CREATE OR REPLACE FUNCTION public.block_rejected_topup_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  IF NEW.top_up_request_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.top_up_requests WHERE id = NEW.top_up_request_id;
    IF v_status = 'rejected' THEN
      RAISE EXCEPTION 'Cannot create seller_transaction for rejected top_up_request %', NEW.top_up_request_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_rejected_topup_sync ON public.seller_transactions;
CREATE TRIGGER trg_block_rejected_topup_sync
  BEFORE INSERT ON public.seller_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.block_rejected_topup_sync();

-- 5. When a top_up_request gets rejected (after approval), also delete any
--    seller_transactions row that was created by the approval-sync trigger.
CREATE OR REPLACE FUNCTION public.cleanup_seller_txn_on_topup_reject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected' AND (OLD.status IS DISTINCT FROM 'rejected') THEN
    DELETE FROM public.seller_transactions
    WHERE top_up_request_id = NEW.id
      AND type = 'client_topup';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_seller_txn_on_topup_reject ON public.top_up_requests;
CREATE TRIGGER trg_cleanup_seller_txn_on_topup_reject
  AFTER UPDATE OF status ON public.top_up_requests
  FOR EACH ROW
  WHEN (NEW.status = 'rejected')
  EXECUTE FUNCTION public.cleanup_seller_txn_on_topup_reject();