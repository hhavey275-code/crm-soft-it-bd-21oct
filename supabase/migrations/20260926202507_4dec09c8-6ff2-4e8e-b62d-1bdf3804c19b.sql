CREATE OR REPLACE FUNCTION public.ping_autopilot_on_topup_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      INSERT INTO public.autopilot_pings DEFAULT VALUES;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.retry_requested_at IS NOT NULL
       AND OLD.retry_requested_at IS DISTINCT FROM NEW.retry_requested_at THEN
      INSERT INTO public.autopilot_pings DEFAULT VALUES;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autopilot_ping_on_topup_request ON public.external_topup_requests;
CREATE TRIGGER trg_autopilot_ping_on_topup_request
AFTER INSERT OR UPDATE OF retry_requested_at ON public.external_topup_requests
FOR EACH ROW
EXECUTE FUNCTION public.ping_autopilot_on_topup_request();