
CREATE TABLE IF NOT EXISTS public.tenant_usage_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  action text NOT NULL,
  amount numeric(18,4) NOT NULL,
  idempotency_key text,
  ad_account_id uuid,
  wallet_txn_id uuid,
  failed_topup_id uuid,
  user_id uuid,
  request_payload jsonb,
  response_status int,
  response_body jsonb,
  local_total_used_before numeric(18,4),
  local_total_used_after numeric(18,4),
  master_total_used_after numeric(18,4),
  master_duplicate boolean,
  error_message text
);

ALTER TABLE public.tenant_usage_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view tenant usage audit"
  ON public.tenant_usage_audit FOR SELECT
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- No INSERT/UPDATE/DELETE policies → only service role (edge functions) can write,
-- and nobody can edit/delete (immutable audit log).

CREATE INDEX IF NOT EXISTS idx_tenant_usage_audit_created_at
  ON public.tenant_usage_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_audit_idem
  ON public.tenant_usage_audit(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_audit_source
  ON public.tenant_usage_audit(source, action);
