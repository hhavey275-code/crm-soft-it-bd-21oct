UPDATE public.seller_transactions
SET status = 'approved',
    reviewed_at = now(),
    admin_note = COALESCE(admin_note, '') || ' [Manual fix: was stuck pending after top-up approval]'
WHERE id = '7a72dd4e-2de3-49d8-a734-b21e585ffd2b'
  AND status = 'pending';