CREATE TABLE IF NOT EXISTS public.spend_cap_withdraw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ad_account_id uuid NOT NULL,
  amount_usd numeric NOT NULL DEFAULT 0,
  note text,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  reviewed_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spend_cap_withdraw_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_spend_cap_withdraw_requests_user_id
  ON public.spend_cap_withdraw_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_spend_cap_withdraw_requests_ad_account_id
  ON public.spend_cap_withdraw_requests(ad_account_id);

CREATE INDEX IF NOT EXISTS idx_spend_cap_withdraw_requests_status
  ON public.spend_cap_withdraw_requests(status);

CREATE TRIGGER update_spend_cap_withdraw_requests_updated_at
BEFORE UPDATE ON public.spend_cap_withdraw_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Admins can manage spend_cap_withdraw_requests"
ON public.spend_cap_withdraw_requests
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Superadmins can manage spend_cap_withdraw_requests"
ON public.spend_cap_withdraw_requests
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Agency owners can manage sub-client spend_cap_withdraw_requests"
ON public.spend_cap_withdraw_requests
FOR ALL
TO authenticated
USING (
  user_id IN (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.agency_id = public.get_agency_id_by_owner(auth.uid())
  )
)
WITH CHECK (
  user_id IN (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.agency_id = public.get_agency_id_by_owner(auth.uid())
  )
);

CREATE POLICY "Clients can insert own spend_cap_withdraw_requests"
ON public.spend_cap_withdraw_requests
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Clients can view own spend_cap_withdraw_requests"
ON public.spend_cap_withdraw_requests
FOR SELECT
TO authenticated
USING (user_id = auth.uid());