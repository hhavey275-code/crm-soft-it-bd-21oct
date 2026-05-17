CREATE POLICY "Sellers can view their own banks"
ON public.bank_accounts
FOR SELECT
TO authenticated
USING (seller_id = auth.uid() AND has_role(auth.uid(), 'seller'::app_role));