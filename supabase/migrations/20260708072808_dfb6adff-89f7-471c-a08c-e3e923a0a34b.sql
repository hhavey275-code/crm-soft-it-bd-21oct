-- 1) default_usd_rate column: each client's onboarding rate (floor)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_usd_rate numeric;

-- Backfill: current usd_rate becomes the default (floor) for all existing profiles
UPDATE public.profiles
   SET default_usd_rate = usd_rate
 WHERE default_usd_rate IS NULL
   AND usd_rate IS NOT NULL;

-- 2) Ensure a site_settings row for the global delta exists (starts at 0)
INSERT INTO public.site_settings (key, value)
VALUES ('global_rate_delta', '0')
ON CONFLICT (key) DO NOTHING;

-- 3) RPC: admin-only. Sets a new absolute global delta (>= 0),
--    then bulk-updates every client's usd_rate = default_usd_rate + delta.
--    Delta can never be < 0 (i.e. usd_rate can never go below default).
CREATE OR REPLACE FUNCTION public.apply_global_rate_delta(
  p_new_delta numeric,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor        uuid := auth.uid();
  v_is_admin     boolean;
  v_old_delta    numeric;
  v_new_delta    numeric;
  v_updated_rows int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin')
             OR public.has_role(v_actor, 'superadmin');
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  IF p_new_delta IS NULL THEN
    RAISE EXCEPTION 'delta required';
  END IF;

  -- Clamp: never below 0 (never below client default rate)
  v_new_delta := GREATEST(0, p_new_delta);

  SELECT COALESCE(NULLIF(value,'')::numeric, 0)
    INTO v_old_delta
    FROM public.site_settings
   WHERE key = 'global_rate_delta';

  -- Ensure every profile has a floor (in case new clients missed backfill)
  UPDATE public.profiles
     SET default_usd_rate = usd_rate
   WHERE default_usd_rate IS NULL
     AND usd_rate IS NOT NULL;

  -- Bulk update all effective rates
  UPDATE public.profiles
     SET usd_rate = default_usd_rate + v_new_delta,
         updated_at = now()
   WHERE default_usd_rate IS NOT NULL;
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  -- Persist the new global delta
  UPDATE public.site_settings
     SET value = v_new_delta::text,
         updated_at = now()
   WHERE key = 'global_rate_delta';

  -- Audit log
  INSERT INTO public.system_logs (user_id, user_name, action, details)
  VALUES (
    v_actor,
    COALESCE((SELECT full_name FROM public.profiles WHERE user_id = v_actor),
             (SELECT email     FROM public.profiles WHERE user_id = v_actor),
             'admin'),
    'Global Rate Delta Updated',
    'Delta changed from ' || v_old_delta || ' → ' || v_new_delta
      || ' (updated ' || v_updated_rows || ' clients)'
      || COALESCE('. Reason: ' || p_reason, '')
  );

  RETURN jsonb_build_object(
    'old_delta',     v_old_delta,
    'new_delta',     v_new_delta,
    'updated_rows',  v_updated_rows
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_global_rate_delta(numeric, text) TO authenticated;
