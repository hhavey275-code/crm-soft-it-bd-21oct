INSERT INTO public.internal_job_secrets (job_name, secret)
VALUES ('referral-nightly-sync', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (job_name) DO NOTHING;

SELECT cron.unschedule('referral-nightly-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'referral-nightly-sync');

SELECT cron.schedule(
  'referral-nightly-sync',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d985f3fc-b84f-4152-b2b7-4cffe71556ee.lovable.app/api/public/referral-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-job-secret', (SELECT secret FROM public.internal_job_secrets WHERE job_name = 'referral-nightly-sync')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);