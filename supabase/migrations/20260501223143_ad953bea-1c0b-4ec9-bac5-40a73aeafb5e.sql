CREATE TABLE IF NOT EXISTS public.seller_balance_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_date DATE NOT NULL,
  seller_id UUID NOT NULL,
  calculated_balance_bdt NUMERIC NOT NULL DEFAULT 0,
  previous_balance_bdt NUMERIC NOT NULL DEFAULT 0,
  delta_bdt NUMERIC NOT NULL DEFAULT 0,
  approved_topup_count INT NOT NULL DEFAULT 0,
  seller_txn_count INT NOT NULL DEFAULT 0,
  orphan_topup_ids UUID[] DEFAULT ARRAY[]::UUID[],
  anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
  has_issues BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_date, seller_id)
);

ALTER TABLE public.seller_balance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit log" ON public.seller_balance_audit_log;
CREATE POLICY "Admins read audit log"
ON public.seller_balance_audit_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

DROP POLICY IF EXISTS "Admins insert audit log" ON public.seller_balance_audit_log;
CREATE POLICY "Admins insert audit log"
ON public.seller_balance_audit_log
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE INDEX IF NOT EXISTS idx_audit_log_date ON public.seller_balance_audit_log(audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_issues ON public.seller_balance_audit_log(has_issues, audit_date DESC) WHERE has_issues = true;
