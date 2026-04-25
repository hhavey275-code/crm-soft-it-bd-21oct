
-- 1) Snapshot history table
CREATE TABLE IF NOT EXISTS public.tenant_stats_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  accounts_total int DEFAULT 0,
  accounts_active int DEFAULT 0,
  accounts_disabled int DEFAULT 0,
  accounts_inactive int DEFAULT 0,
  spend_today numeric DEFAULT 0,
  spend_yesterday numeric DEFAULT 0,
  spend_this_month numeric DEFAULT 0,
  spend_last_30d numeric DEFAULT 0,
  spend_lifetime numeric DEFAULT 0,
  orders_today int DEFAULT 0,
  orders_yesterday int DEFAULT 0,
  total_wallet_balance numeric DEFAULT 0,
  total_clients int DEFAULT 0,
  active_clients_today int DEFAULT 0,
  topups_today_count int DEFAULT 0,
  topups_today_amount numeric DEFAULT 0,
  topups_pending_count int DEFAULT 0,
  raw jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tenant_stats_snapshots_tenant_time
  ON public.tenant_stats_snapshots (tenant_id, snapshot_at DESC);

ALTER TABLE public.tenant_stats_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage tenant_stats_snapshots" ON public.tenant_stats_snapshots;
CREATE POLICY "Admins manage tenant_stats_snapshots"
  ON public.tenant_stats_snapshots FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'superadmin'::app_role));

-- 2) Cache columns on tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stats_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stats_accounts_total int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_accounts_active int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_accounts_disabled int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_accounts_inactive int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_today numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_yesterday numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_month numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_last_30d numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_lifetime numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_orders_today int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_orders_yesterday int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_total_wallet numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_total_clients int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_active_clients_today int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_topups_today_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_topups_today_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_topups_pending int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_top_accounts jsonb DEFAULT '[]'::jsonb;
