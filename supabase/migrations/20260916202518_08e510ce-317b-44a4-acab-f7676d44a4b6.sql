ALTER TABLE public.external_topup_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.external_topup_requests;