UPDATE public.ad_account_insights AS i
SET
  balance = CASE
    WHEN COALESCE(i.balance, 0) = 0 AND COALESCE(s.balance, 0) <> 0 THEN s.balance
    ELSE i.balance
  END,
  cards = CASE
    WHEN jsonb_array_length(COALESCE(i.cards, '[]'::jsonb)) = 0
      AND jsonb_array_length(COALESCE(s.cards, '[]'::jsonb)) > 0 THEN s.cards
    ELSE i.cards
  END,
  last_spend_date = COALESCE(i.last_spend_date, s.last_spend_date),
  updated_at = now()
FROM public.ad_account_last_known_state AS s
WHERE i.ad_account_id = s.ad_account_id
  AND (
    (COALESCE(i.balance, 0) = 0 AND COALESCE(s.balance, 0) <> 0)
    OR (jsonb_array_length(COALESCE(i.cards, '[]'::jsonb)) = 0 AND jsonb_array_length(COALESCE(s.cards, '[]'::jsonb)) > 0)
    OR (i.last_spend_date IS NULL AND s.last_spend_date IS NOT NULL)
  );