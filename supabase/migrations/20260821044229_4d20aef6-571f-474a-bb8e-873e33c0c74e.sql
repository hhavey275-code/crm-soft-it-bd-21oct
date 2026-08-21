CREATE OR REPLACE FUNCTION public.enforce_topup_credit_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN
    IF COALESCE(NEW.amount, 0) > 0
       AND COALESCE(NEW.sheet_bill_bdt, 0) < COALESCE(NEW.bdt_amount, 0)
       AND NOT EXISTS (
         SELECT 1 FROM public.transactions
         WHERE reference_id = NEW.id AND type = 'top_up'
       )
    THEN
      RAISE EXCEPTION 'Blocked: top-up cannot be approved without a wallet credit. Use the approve button (atomic approval) — direct status changes are not allowed.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_topup_credit_on_approval_trg ON public.top_up_requests;
CREATE TRIGGER enforce_topup_credit_on_approval_trg
BEFORE UPDATE ON public.top_up_requests
FOR EACH ROW
EXECUTE FUNCTION public.enforce_topup_credit_on_approval();