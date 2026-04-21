
ALTER TABLE public.failed_topups
  ADD COLUMN IF NOT EXISTS last_attempt_via text,
  ADD COLUMN IF NOT EXISTS last_attempt_ip text,
  ADD COLUMN IF NOT EXISTS resolved_via text,
  ADD COLUMN IF NOT EXISTS resolved_ip text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS via text,
  ADD COLUMN IF NOT EXISTS source_ip text;
