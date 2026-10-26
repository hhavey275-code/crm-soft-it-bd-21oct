-- AI Ads Agent (chat/voice) — confirmed plans are stored as tasks and executed step by step
-- through /api/managed-ads as the client (same ownership + wallet checks), now or on a schedule.
CREATE TABLE IF NOT EXISTS public.ads_agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  repeat text NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily')),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'running', 'done', 'failed', 'cancelled')),
  locked_until timestamptz,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ads_agent_tasks_due_idx ON public.ads_agent_tasks (status, run_at);
CREATE INDEX IF NOT EXISTS ads_agent_tasks_user_idx ON public.ads_agent_tasks (user_id, created_at DESC);

ALTER TABLE public.ads_agent_tasks ENABLE ROW LEVEL SECURITY;

-- Clients only read their own tasks; every write goes through the server (service role).
DROP POLICY IF EXISTS "Users read own ads agent tasks" ON public.ads_agent_tasks;
CREATE POLICY "Users read own ads agent tasks" ON public.ads_agent_tasks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Secret for the per-minute runner and for the agent's server-to-server calls into /api/managed-ads.
INSERT INTO public.internal_job_secrets (job_name, secret)
VALUES ('ads-agent-tasks', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (job_name) DO NOTHING;

SELECT cron.unschedule('ads-agent-tasks') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ads-agent-tasks');

SELECT cron.schedule(
  'ads-agent-tasks',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://app.softitbd.com/api/public/ads-agent-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-job-secret', (SELECT secret FROM public.internal_job_secrets WHERE job_name = 'ads-agent-tasks')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
