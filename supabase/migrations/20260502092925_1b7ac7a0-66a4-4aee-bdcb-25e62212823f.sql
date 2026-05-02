DROP TRIGGER IF EXISTS trg_sheet_sync_on_seller_txn_insert ON public.seller_transactions;
DROP TRIGGER IF EXISTS trg_sheet_sync_on_seller_txn_update ON public.seller_transactions;

CREATE TRIGGER trg_sheet_sync_on_seller_txn_insert
AFTER INSERT ON public.seller_transactions
FOR EACH ROW
WHEN (NEW.status = 'approved')
EXECUTE FUNCTION public.trigger_sheet_sync_on_seller_txn();

CREATE TRIGGER trg_sheet_sync_on_seller_txn_update
AFTER UPDATE OF status ON public.seller_transactions
FOR EACH ROW
WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
EXECUTE FUNCTION public.trigger_sheet_sync_on_seller_txn();