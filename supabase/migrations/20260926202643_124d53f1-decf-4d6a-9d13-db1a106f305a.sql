UPDATE public.external_topup_requests
SET retry_requested_at = now(),
    retry_count = COALESCE(retry_count, 0) + 1,
    automation_started_at = NULL,
    last_error = NULL,
    limit_status = 'pending',
    limit_reason = 'Retry queue-তে — helper আবার CRM-এ top-up দেবে',
    updated_at = now()
WHERE id = 'd714859d-5f66-4a54-aaad-3b249204fef3'
  AND status = 'completed'
  AND spend_cap_after IS NULL
  AND retry_requested_at IS NULL;