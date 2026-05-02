-- Expose pg_advisory_lock / pg_advisory_unlock as RPCs so edge functions can serialize per-(seller, tab) sheet syncs.
CREATE OR REPLACE FUNCTION public.pg_advisory_lock(key bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_lock(key);
$$;

CREATE OR REPLACE FUNCTION public.pg_advisory_unlock(key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(key);
$$;

REVOKE ALL ON FUNCTION public.pg_advisory_lock(bigint) FROM public;
REVOKE ALL ON FUNCTION public.pg_advisory_unlock(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.pg_advisory_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_advisory_unlock(bigint) TO service_role;