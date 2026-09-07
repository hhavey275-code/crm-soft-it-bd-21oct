ALTER TABLE public.custom_invoices
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.custom_invoices
  DROP CONSTRAINT IF EXISTS custom_invoices_payment_status_check;

ALTER TABLE public.custom_invoices
  ADD CONSTRAINT custom_invoices_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'partial'));