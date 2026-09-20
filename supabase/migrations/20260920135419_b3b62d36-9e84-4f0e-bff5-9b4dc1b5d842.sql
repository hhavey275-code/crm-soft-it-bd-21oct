CREATE OR REPLACE FUNCTION public.my_referred_clients(p_month date DEFAULT date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka'))::date)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  status text,
  joined_at timestamptz,
  ad_accounts integer,
  month_spend numeric,
  month_commission numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.full_name,
    p.email,
    p.status,
    p.created_at AS joined_at,
    COALESCE((SELECT count(*) FROM public.ad_accounts a WHERE a.user_id = p.user_id), 0)::int AS ad_accounts,
    COALESCE((SELECT sum(e.spend_usd) FROM public.referral_account_earnings e
              WHERE e.referrer_id = auth.uid() AND e.referred_user_id = p.user_id
                AND e.period_month = date_trunc('month', p_month)::date), 0) AS month_spend,
    COALESCE((SELECT sum(e.commission_bdt) FROM public.referral_account_earnings e
              WHERE e.referrer_id = auth.uid() AND e.referred_user_id = p.user_id
                AND e.period_month = date_trunc('month', p_month)::date), 0) AS month_commission
  FROM public.profiles p
  WHERE p.referred_by = auth.uid()
  ORDER BY p.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.my_referred_clients(date) FROM public;
GRANT EXECUTE ON FUNCTION public.my_referred_clients(date) TO authenticated;