REVOKE ALL ON FUNCTION public.wa_enqueue(uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_enqueue(uuid, text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.wa_enqueue(uuid, text, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wa_enqueue(uuid, text, jsonb, text) TO service_role;