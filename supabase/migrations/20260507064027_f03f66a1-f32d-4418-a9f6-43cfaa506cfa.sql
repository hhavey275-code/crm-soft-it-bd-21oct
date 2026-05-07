-- Backup existing ledger
CREATE TABLE IF NOT EXISTS public.tenant_limit_ledger_backup_20260507 AS
SELECT * FROM public.tenant_limit_ledger
WHERE tenant_id = '088158d0-af15-48cf-ac8c-11a8f70c2ef1';

-- Wipe scale up tenant ledger
DELETE FROM public.tenant_limit_ledger WHERE tenant_id = '088158d0-af15-48cf-ac8c-11a8f70c2ef1';

-- Inserts will be loaded from /tmp/ledger_inserts.sql via psql in next step
-- Placeholder; actual bulk insert provided by follow-up call.

-- Sync tenant totals to final computed values
UPDATE public.tenants
SET system_limit = 9008.12,
    total_used   = 8139.49,
    updated_at   = now()
WHERE id = '088158d0-af15-48cf-ac8c-11a8f70c2ef1';