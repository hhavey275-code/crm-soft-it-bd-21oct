CREATE TABLE public.autopilot_pings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.autopilot_pings TO anon;
GRANT ALL ON public.autopilot_pings TO service_role;
ALTER TABLE public.autopilot_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pings are readable as a public wake-up signal" ON public.autopilot_pings FOR SELECT TO anon USING (true);

CREATE OR REPLACE FUNCTION public.ping_autopilot_on_topup_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.autopilot_pings DEFAULT VALUES;
    DELETE FROM public.autopilot_pings WHERE created_at < now() - interval '1 hour';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_autopilot_ping_on_topup_request
AFTER INSERT ON public.external_topup_requests
FOR EACH ROW EXECUTE FUNCTION public.ping_autopilot_on_topup_request();

ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_pings;