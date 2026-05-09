
-- Identify ghost / non-card payment_method rows that leaked in before the
-- v2.4.0 extension fix. These are entries whose display_string is not a real
-- card (no 4-digit last4, or shows base64 tails like "Card ...MzU=", or
-- "Unknown card", "Available balance ...", "monthly invoicing", etc.).
WITH ghosts AS (
  SELECT id, funding_source_id
  FROM public.ad_account_cards
  WHERE display_string ~ '\.\.\.[A-Za-z+/=]'
     OR display_string !~ '\d{4}'
)
DELETE FROM public.ad_account_card_assignments
WHERE funding_source_id IN (SELECT funding_source_id FROM ghosts)
   OR card_id           IN (SELECT id FROM ghosts);

DELETE FROM public.ad_account_cards
WHERE display_string ~ '\.\.\.[A-Za-z+/=]'
   OR display_string !~ '\d{4}';

-- Strip the same ghosts out of the cached snapshot JSON on each ad account.
UPDATE public.ad_account_last_known_state
SET cards = COALESCE((
  SELECT jsonb_agg(c)
  FROM jsonb_array_elements(cards) AS c
  WHERE (c->>'display_string') ~ '\d{4}'
    AND (c->>'display_string') !~ '\.\.\.[A-Za-z+/=]'
    AND (c->>'display_string') NOT ILIKE 'Available balance%'
    AND (c->>'display_string') NOT ILIKE 'Unknown card%'
    AND (c->>'display_string') NOT ILIKE 'monthly invoicing%'
), '[]'::jsonb)
WHERE cards IS NOT NULL
  AND jsonb_typeof(cards) = 'array';

UPDATE public.ad_account_insights
SET cards = COALESCE((
  SELECT jsonb_agg(c)
  FROM jsonb_array_elements(cards) AS c
  WHERE (c->>'display_string') ~ '\d{4}'
    AND (c->>'display_string') !~ '\.\.\.[A-Za-z+/=]'
    AND (c->>'display_string') NOT ILIKE 'Available balance%'
    AND (c->>'display_string') NOT ILIKE 'Unknown card%'
    AND (c->>'display_string') NOT ILIKE 'monthly invoicing%'
), '[]'::jsonb)
WHERE cards IS NOT NULL
  AND jsonb_typeof(cards) = 'array';
