
-- Ensure a global default USD rate setting exists
INSERT INTO public.site_settings (key, value)
VALUES ('usd_rate', '140')
ON CONFLICT (key) DO NOTHING;

-- New signups inherit the global default rate
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id uuid;
  v_agency_slug text;
  v_default_rate numeric;
BEGIN
  v_agency_slug := NEW.raw_user_meta_data->>'agency_slug';
  IF v_agency_slug IS NOT NULL AND v_agency_slug != '' THEN
    SELECT id INTO v_agency_id FROM public.agencies WHERE slug = v_agency_slug AND status = 'active';
  END IF;

  SELECT NULLIF(value, '')::numeric INTO v_default_rate
  FROM public.site_settings WHERE key = 'usd_rate';

  INSERT INTO public.profiles (
    user_id, email, full_name, company, phone, business_address, monthly_spend, agency_id,
    usd_rate, default_usd_rate
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'company',
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'business_address',
    NEW.raw_user_meta_data->>'monthly_spend',
    v_agency_id,
    v_default_rate,
    v_default_rate
  );
  INSERT INTO public.wallets (user_id) VALUES (NEW.id);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client');
  RETURN NEW;
END;
$$;

-- Backfill clients that never got a rate
UPDATE public.profiles p
SET usd_rate = COALESCE(p.usd_rate, (SELECT NULLIF(value,'')::numeric FROM public.site_settings WHERE key='usd_rate')),
    default_usd_rate = COALESCE(p.default_usd_rate, (SELECT NULLIF(value,'')::numeric FROM public.site_settings WHERE key='usd_rate'))
WHERE p.usd_rate IS NULL OR p.default_usd_rate IS NULL;
