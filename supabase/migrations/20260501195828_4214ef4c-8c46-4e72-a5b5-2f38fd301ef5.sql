
-- Spread same-date BDT payments (with 00:00:00 timestamp) across the day in id-order
-- so they interleave with client_topup rows that have real timestamps.
WITH ranked AS (
  SELECT
    id,
    created_at::date AS d,
    ROW_NUMBER() OVER (
      PARTITION BY seller_id, created_at::date
      ORDER BY id
    ) - 1 AS rn,
    COUNT(*) OVER (PARTITION BY seller_id, created_at::date) AS cnt
  FROM public.seller_transactions
  WHERE type = 'bdt_payment'
    AND (created_at AT TIME ZONE 'UTC')::time = TIME '00:00:00'
)
UPDATE public.seller_transactions st
SET created_at = (
  -- distribute evenly between 06:00 and 22:00 within that date
  ((ranked.d::timestamp) + INTERVAL '6 hours'
    + (INTERVAL '16 hours' * (ranked.rn::numeric / GREATEST(ranked.cnt, 1)::numeric))
  ) AT TIME ZONE 'UTC'
)
FROM ranked
WHERE st.id = ranked.id;
