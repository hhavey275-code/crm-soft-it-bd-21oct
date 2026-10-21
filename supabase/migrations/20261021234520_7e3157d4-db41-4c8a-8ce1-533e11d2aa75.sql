INSERT INTO public.site_settings (key, value)
SELECT 'softcards_sweep_url', 'https://app.softitbd.com/api/public/webhooks/softcards-deposit'
WHERE NOT EXISTS (SELECT 1 FROM public.site_settings WHERE key = 'softcards_sweep_url');

CREATE OR REPLACE FUNCTION public.softcards_ping_on_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT value INTO v_url FROM public.site_settings WHERE key = 'softcards_sweep_url';
  IF v_url IS NOT NULL AND length(v_url) > 0 THEN
    PERFORM net.http_post(
      url := v_url,
      body := '{"action":"sms_ping"}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_softcards_ping_on_sms ON public.telegram_messages;
CREATE TRIGGER trg_softcards_ping_on_sms
AFTER INSERT ON public.telegram_messages
FOR EACH ROW EXECUTE FUNCTION public.softcards_ping_on_sms();