ALTER TABLE public.top_up_requests ADD COLUMN IF NOT EXISTS forward_dismissed_at TIMESTAMPTZ;
ALTER TABLE public.top_up_requests ADD COLUMN IF NOT EXISTS forward_dismissed_by UUID;