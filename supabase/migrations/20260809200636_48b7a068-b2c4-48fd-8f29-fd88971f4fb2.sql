ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS old_spend_cap numeric,
  ADD COLUMN IF NOT EXISTS new_spend_cap numeric;