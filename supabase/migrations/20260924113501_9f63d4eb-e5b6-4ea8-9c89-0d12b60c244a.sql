WITH k AS (
  SELECT ad_account_id,
    bool_or(wallet_kind='primary') p, bool_or(wallet_kind='secondary') s, bool_or(wallet_kind='credit_line') c
  FROM public.external_topup_requests GROUP BY ad_account_id
)
UPDATE public.ad_accounts a SET
  external_topup_url_secondary = CASE WHEN k.s THEN COALESCE(a.external_topup_url, a.external_topup_url_secondary) ELSE NULL END,
  external_topup_url_credit_line = CASE WHEN k.c THEN COALESCE(a.external_topup_url, a.external_topup_url_credit_line) ELSE NULL END,
  external_topup_url = CASE WHEN k.p THEN a.external_topup_url ELSE NULL END
FROM k
WHERE k.ad_account_id = a.id AND a.external_topup_required AND (k.s OR k.c);