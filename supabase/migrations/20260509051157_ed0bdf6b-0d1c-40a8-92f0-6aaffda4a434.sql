WITH ghost_cards AS (
  SELECT id, funding_source_id
  FROM public.ad_account_cards
  WHERE funding_source_id ~ '^[A-Za-z0-9+/]+={0,2}$'
    AND display_string ~* '^CARD \*[0-9]{4}$'
), ghost_assignments AS (
  SELECT DISTINCT ad_account_id, funding_source_id
  FROM public.ad_account_card_assignments
  WHERE funding_source_id IN (SELECT funding_source_id FROM ghost_cards)
     OR (funding_source_id ~ '^[A-Za-z0-9+/]+={0,2}$' AND display_string ~* '^CARD \*[0-9]{4}$')
)
DELETE FROM public.ad_account_card_assignments a
USING ghost_assignments g
WHERE a.ad_account_id = g.ad_account_id
  AND a.funding_source_id = g.funding_source_id;

WITH ghost_cards AS (
  SELECT id, funding_source_id
  FROM public.ad_account_cards
  WHERE funding_source_id ~ '^[A-Za-z0-9+/]+={0,2}$'
    AND display_string ~* '^CARD \*[0-9]{4}$'
)
DELETE FROM public.ad_account_cards c
USING ghost_cards g
WHERE c.id = g.id;

UPDATE public.ad_account_last_known_state
SET cards = COALESCE((
  SELECT jsonb_agg(card)
  FROM jsonb_array_elements(cards) AS card
  WHERE NOT (
    COALESCE(card->>'id', '') ~ '^[A-Za-z0-9+/]+={0,2}$'
    AND COALESCE(card->>'display_string', '') ~* '^CARD \*[0-9]{4}$'
  )
), '[]'::jsonb)
WHERE jsonb_typeof(cards) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cards) AS card
    WHERE COALESCE(card->>'id', '') ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND COALESCE(card->>'display_string', '') ~* '^CARD \*[0-9]{4}$'
  );

UPDATE public.ad_account_insights
SET cards = COALESCE((
  SELECT jsonb_agg(card)
  FROM jsonb_array_elements(cards) AS card
  WHERE NOT (
    COALESCE(card->>'id', '') ~ '^[A-Za-z0-9+/]+={0,2}$'
    AND COALESCE(card->>'display_string', '') ~* '^CARD \*[0-9]{4}$'
  )
), '[]'::jsonb)
WHERE jsonb_typeof(cards) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cards) AS card
    WHERE COALESCE(card->>'id', '') ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND COALESCE(card->>'display_string', '') ~* '^CARD \*[0-9]{4}$'
  );