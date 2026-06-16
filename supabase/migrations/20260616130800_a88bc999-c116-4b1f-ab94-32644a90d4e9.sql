ALTER TABLE public.top_up_requests
  ADD COLUMN IF NOT EXISTS sheet_bill_bdt numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_due_paid_bdt numeric DEFAULT 0;