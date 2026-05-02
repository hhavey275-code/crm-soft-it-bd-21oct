-- 1) Idempotency table for tenant usage report deduplication
CREATE TABLE IF NOT EXISTS public.tenant_usage_report_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE public.tenant_usage_report_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins manage tenant_usage_report_keys"
  ON public.tenant_usage_report_keys
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(),'superadmin'::app_role));

CREATE POLICY "Admins read tenant_usage_report_keys"
  ON public.tenant_usage_report_keys
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_tenant_usage_keys_tenant ON public.tenant_usage_report_keys(tenant_id, created_at DESC);

-- 2) One-off data correction: align master total_used with tenant's actual dashboard value
UPDATE public.tenants
SET total_used = 4898.50,
    updated_at = now()
WHERE id = '088158d0-af15-48cf-ac8c-11a8f70c2ef1';
