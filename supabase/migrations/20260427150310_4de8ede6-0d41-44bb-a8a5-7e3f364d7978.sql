ALTER TABLE public.seller_transactions
  DROP CONSTRAINT IF EXISTS seller_transactions_type_check;

ALTER TABLE public.seller_transactions
  ADD CONSTRAINT seller_transactions_type_check
  CHECK (type = ANY (ARRAY['usdt_received'::text, 'bdt_payment'::text, 'client_topup'::text, 'withdraw'::text, 'tenant_payment'::text]));