-- 1. Per-seller approve permission
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_approve_topups boolean NOT NULL DEFAULT false;

-- 2. RLS: sellers can UPDATE only pending top_up_requests on their own banks,
--    and only if the per-seller toggle is enabled.
DROP POLICY IF EXISTS "Sellers can approve own bank topups" ON public.top_up_requests;
CREATE POLICY "Sellers can approve own bank topups"
ON public.top_up_requests
FOR UPDATE
TO authenticated
USING (
  status = 'pending'
  AND bank_account_id IN (
    SELECT b.id FROM public.bank_accounts b WHERE b.seller_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.can_approve_topups = true
  )
)
WITH CHECK (
  bank_account_id IN (
    SELECT b.id FROM public.bank_accounts b WHERE b.seller_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.can_approve_topups = true
  )
);

-- 3. Notify seller on new top-up request on their bank (only if toggle ON).
CREATE OR REPLACE FUNCTION public.notify_seller_on_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_seller_id uuid;
  v_can_approve boolean;
BEGIN
  IF NEW.bank_account_id IS NULL THEN RETURN NEW; END IF;
  SELECT seller_id INTO v_seller_id FROM public.bank_accounts WHERE id = NEW.bank_account_id;
  IF v_seller_id IS NULL THEN RETURN NEW; END IF;
  SELECT can_approve_topups INTO v_can_approve FROM public.profiles WHERE user_id = v_seller_id;
  IF NOT COALESCE(v_can_approve, false) THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, type, title, message, reference_id)
  VALUES (
    v_seller_id,
    'top_up_request',
    'New Top-Up on Your Bank',
    'A client submitted a top-up request for $' || NEW.amount || ' on your bank. You can approve or reject it.',
    NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_seller_on_topup_trg ON public.top_up_requests;
CREATE TRIGGER notify_seller_on_topup_trg
AFTER INSERT ON public.top_up_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_seller_on_topup();