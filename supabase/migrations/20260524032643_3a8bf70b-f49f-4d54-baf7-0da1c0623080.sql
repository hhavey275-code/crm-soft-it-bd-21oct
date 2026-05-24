DELETE FROM public.tenant_limit_ledger WHERE tenant_id='088158d0-af15-48cf-ac8c-11a8f70c2ef1';
DELETE FROM public.tenant_usage_report_keys WHERE tenant_id='088158d0-af15-48cf-ac8c-11a8f70c2ef1';
UPDATE public.tenants SET total_used=0, updated_at=now() WHERE id='088158d0-af15-48cf-ac8c-11a8f70c2ef1';