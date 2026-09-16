ALTER TABLE public.external_topup_requests
  ADD COLUMN IF NOT EXISTS crm_provider text,
  ADD COLUMN IF NOT EXISTS provider_txn_id text,
  ADD COLUMN IF NOT EXISTS auto_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS automation_started_at timestamptz;

CREATE TABLE IF NOT EXISTS public.crm_automation_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host text NOT NULL UNIQUE,
  name text,
  selectors jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_confirm boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_automation_configs TO authenticated;
GRANT ALL ON public.crm_automation_configs TO service_role;

ALTER TABLE public.crm_automation_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view crm automation configs" ON public.crm_automation_configs;
CREATE POLICY "Admins can view crm automation configs"
ON public.crm_automation_configs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

DROP TRIGGER IF EXISTS update_crm_automation_configs_updated_at ON public.crm_automation_configs;
CREATE TRIGGER update_crm_automation_configs_updated_at
BEFORE UPDATE ON public.crm_automation_configs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.fail_external_topup(p_id uuid, p_error text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.external_topup_requests;
BEGIN
  SELECT * INTO r FROM public.external_topup_requests WHERE id = p_id;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request not found');
  END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request is not pending');
  END IF;
  UPDATE public.external_topup_requests
     SET last_error = p_error,
         auto_attempts = COALESCE(auto_attempts, 0) + 1
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fail_external_topup(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_external_topup(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fail_external_topup(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_external_topup(uuid, text) TO service_role;