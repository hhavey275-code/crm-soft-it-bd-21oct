-- Reset telegram_forwarded to NULL for top-ups whose receiving bank has no Telegram group.
-- Those rows should display "—" (no forward expected), not "Not Forwarded".
UPDATE public.top_up_requests t
SET telegram_forwarded = NULL
FROM public.bank_accounts b
WHERE t.bank_account_id = b.id
  AND t.telegram_forwarded = false
  AND (b.telegram_group_id IS NULL OR b.telegram_group_id = '');

-- Also reset rows with no bank at all.
UPDATE public.top_up_requests
SET telegram_forwarded = NULL
WHERE telegram_forwarded = false
  AND bank_account_id IS NULL;