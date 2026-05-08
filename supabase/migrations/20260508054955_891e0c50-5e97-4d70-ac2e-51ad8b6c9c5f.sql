SELECT cron.schedule(
  'auto-verify-pending-every-min',
  '* * * * *',
  $$
    SELECT net.http_post(
      url:='https://dhswrfzdqcavgmymllat.supabase.co/functions/v1/auto-verify-pending',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s"}'::jsonb,
      body:='{}'::jsonb
    ) as request_id;
  $$
);