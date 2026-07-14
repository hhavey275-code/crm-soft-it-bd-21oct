ALTER TABLE public.tenant_limit_ledger_backup_20260507 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tenant_limit_ledger_backup_20260507 FROM anon, authenticated;
GRANT ALL ON public.tenant_limit_ledger_backup_20260507 TO service_role;

CREATE POLICY "No client access to backup table"
  ON public.tenant_limit_ledger_backup_20260507
  FOR ALL
  USING (false)
  WITH CHECK (false);