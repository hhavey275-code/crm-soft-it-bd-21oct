ALTER TABLE public.external_topup_requests
  ADD COLUMN IF NOT EXISTS retry_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS limit_reason text;
CREATE INDEX IF NOT EXISTS idx_ext_topup_retry ON public.external_topup_requests (retry_requested_at) WHERE retry_requested_at IS NOT NULL;