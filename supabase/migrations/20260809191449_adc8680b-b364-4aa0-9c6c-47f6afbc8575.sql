ALTER TABLE public.failed_topups
  ADD COLUMN IF NOT EXISTS wallet_kind text NOT NULL DEFAULT 'primary';