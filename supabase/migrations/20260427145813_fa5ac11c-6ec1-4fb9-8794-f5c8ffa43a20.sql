ALTER TABLE public.seller_transactions
  ADD COLUMN IF NOT EXISTS tenant_payment_id uuid REFERENCES public.tenant_payments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS seller_transactions_tenant_payment_unique
  ON public.seller_transactions (tenant_payment_id)
  WHERE tenant_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS seller_transactions_tenant_payment_idx
  ON public.seller_transactions (tenant_payment_id);