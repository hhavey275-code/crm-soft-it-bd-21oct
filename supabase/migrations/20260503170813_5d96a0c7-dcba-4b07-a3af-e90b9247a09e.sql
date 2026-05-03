-- Allow sellers to view top_up_requests on their own banks (so they can see entries that didn't make it into seller_transactions)
CREATE POLICY "Sellers can view top_ups on own banks"
ON public.top_up_requests
FOR SELECT
TO authenticated
USING (
  bank_account_id IN (
    SELECT id FROM public.bank_accounts WHERE seller_id = auth.uid()
  )
);