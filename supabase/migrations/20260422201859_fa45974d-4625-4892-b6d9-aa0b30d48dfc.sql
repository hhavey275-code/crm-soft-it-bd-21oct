DROP POLICY IF EXISTS "Public can read non-sensitive settings" ON public.site_settings;

CREATE POLICY "Public can read non-sensitive settings"
ON public.site_settings
FOR SELECT
TO anon, authenticated
USING (
  key = ANY (ARRAY[
    'site_name','logo_url','usd_rate','is_tenant',
    'license_subscription_paid_until','support_phone','support_email',
    'maintenance_mode','announcement','primary_color','favicon_url',
    'header_announcement','announcement_color','announcement_size',
    'welcome_title','welcome_note'
  ])
);