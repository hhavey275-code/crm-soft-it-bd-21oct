-- 1) Delete two stray pre-CRM-launch entries (Jan 9, 2024 typo + Apr 7, 2025 typo)
--    User confirmed CRM started March 2026, these break serial ordering.
DELETE FROM public.seller_transactions
WHERE created_at < '2026-03-01'::timestamptz;

-- 2) Trigger: prevent rejected seller_transactions from ever sitting in DB.
--    If a row is INSERTed/UPDATEd to status='rejected', delete it instead.
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

DROP TRIGGER IF EXISTS trg_purge_rejected_seller_txn_ins ON public.seller_transactions;
CREATE TRIGGER trg_purge_rejected_seller_txn_ins
AFTER INSERT ON public.seller_transactions
FOR EACH ROW EXECUTE FUNCTION public.purge_rejected_seller_txn();

DROP TRIGGER IF EXISTS trg_purge_rejected_seller_txn_upd ON public.seller_transactions;
CREATE TRIGGER trg_purge_rejected_seller_txn_upd
AFTER UPDATE OF status ON public.seller_transactions
FOR EACH ROW
WHEN (NEW.status = 'rejected')
EXECUTE FUNCTION public.purge_rejected_seller_txn();

-- 3) View: month-to-month opening / closing per seller (Asia/Dhaka months).
CREATE OR REPLACE VIEW public.seller_monthly_balance_view
WITH (security_invoker=on) AS
WITH txn AS (
  SELECT
    seller_id,
    date_trunc('month', (created_at AT TIME ZONE 'Asia/Dhaka'))::date AS month_start,
    CASE
      WHEN status = 'approved' AND type IN ('bdt_payment','client_topup','tenant_payment')
        THEN COALESCE(bdt_amount,0)
      WHEN status = 'approved' AND type = 'withdraw'
        THEN -ABS(COALESCE(bdt_amount,0))
      WHEN status = 'approved' AND type = 'usdt_received'
        THEN -ABS(COALESCE(usdt_amount,0)) * COALESCE(rate,0)
      ELSE 0
    END AS delta
  FROM public.seller_transactions
),
monthly AS (
  SELECT seller_id, month_start, SUM(delta) AS month_delta
  FROM txn
  GROUP BY seller_id, month_start
)
SELECT
  seller_id,
  month_start,
  to_char(month_start, 'Mon YYYY') AS month_label,
  COALESCE(SUM(month_delta) OVER (
     PARTITION BY seller_id
     ORDER BY month_start
     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
  ), 0) AS opening_balance,
  month_delta,
  SUM(month_delta) OVER (
     PARTITION BY seller_id
     ORDER BY month_start
     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS closing_balance
FROM monthly
ORDER BY seller_id, month_start;