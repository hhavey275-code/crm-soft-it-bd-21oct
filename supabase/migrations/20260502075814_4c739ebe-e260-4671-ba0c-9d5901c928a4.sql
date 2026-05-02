-- Durable dedupe log for Telegram forwards
CREATE TABLE IF NOT EXISTS public.telegram_forward_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('client_topup','seller_payment','usdt_received','withdraw','tenant_payment')),
  source_id uuid NOT NULL,
  telegram_group_id text,
  telegram_message_id bigint,
  caption_total_bdt numeric,
  forwarded_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_forward_log_source_unique
  ON public.telegram_forward_log (source_type, source_id);

CREATE INDEX IF NOT EXISTS telegram_forward_log_forwarded_at_idx
  ON public.telegram_forward_log (forwarded_at DESC);

ALTER TABLE public.telegram_forward_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage telegram_forward_log"
  ON public.telegram_forward_log
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Superadmins manage telegram_forward_log"
  ON public.telegram_forward_log
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));