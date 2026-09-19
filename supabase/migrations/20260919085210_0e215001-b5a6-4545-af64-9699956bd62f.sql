ALTER TABLE public.spend_cap_withdraw_requests
  ADD COLUMN IF NOT EXISTS spend_cap_before numeric,
  ADD COLUMN IF NOT EXISTS spend_cap_after numeric;