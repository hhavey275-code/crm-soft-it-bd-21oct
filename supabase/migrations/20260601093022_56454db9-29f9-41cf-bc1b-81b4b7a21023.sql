-- Fix Najmul's 640k bdt_payment that had OCR-misread year (2020 → 2026)
UPDATE public.seller_transactions
SET created_at = '2026-06-01 06:18:40.843+00'
WHERE id = '7327e9cd-912a-40d1-a239-43f1a5976620';

-- Clear failed sync log rows so they re-sync once Google Sheets is reconnected
DELETE FROM public.sheet_sync_log
WHERE status = 'error'
  AND error_message LIKE '%Credential not found%';