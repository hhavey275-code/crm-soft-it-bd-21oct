UPDATE public.ad_account_insights
SET daily_spend_limit = daily_spend_limit * 100,
    updated_at = now()
WHERE daily_spend_limit > 0
  AND daily_spend_limit < 100;
