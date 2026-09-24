DO $$
DECLARE r record; v_bal numeric; v_res jsonb;
BEGIN
  CREATE TEMP TABLE _ext ON COMMIT DROP AS
  SELECT a.id acct, (SELECT u.user_id FROM public.user_ad_accounts u WHERE u.ad_account_id=a.id LIMIT 1) uid,
         COALESCE(a.external_topup_url, a.external_topup_url_credit_line, a.external_topup_url_secondary) link,
         (a.external_topup_url_secondary IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.external_topup_requests x WHERE x.ad_account_id=a.id AND x.wallet_kind='secondary')) sec_conn
  FROM public.ad_accounts a WHERE a.external_topup_required;

  -- Secondary connected to external CRM, credit line off -> migrate to credit line
  FOR r IN SELECT DISTINCT p.user_id, p.secondary_usd_rate, p.secondary_due_limit
           FROM _ext e JOIN public.profiles p ON p.user_id=e.uid
           WHERE e.sec_conn AND COALESCE(p.secondary_wallet_enabled,false) AND NOT COALESCE(p.credit_line_wallet_enabled,false)
  LOOP
    UPDATE public.profiles SET credit_line_wallet_enabled=true,
      credit_line_usd_rate=COALESCE(r.secondary_usd_rate, credit_line_usd_rate),
      credit_line_due_limit=COALESCE(r.secondary_due_limit, credit_line_due_limit),
      secondary_wallet_enabled=false
    WHERE user_id=r.user_id;
    SELECT COALESCE(balance,0) INTO v_bal FROM public.secondary_wallets WHERE user_id=r.user_id;
    IF COALESCE(v_bal,0) <> 0 THEN
      v_res := public.adjust_wallet_atomic(r.user_id, -v_bal, 'adjustment', 'Secondary → Credit Line shift', 'system', 'secondary', NULL, true);
      IF NOT COALESCE((v_res->>'ok')::boolean, true) THEN RAISE EXCEPTION 'shift out failed %: %', r.user_id, v_res; END IF;
      v_res := public.adjust_wallet_atomic(r.user_id, v_bal, 'adjustment', 'Secondary → Credit Line shift', 'system', 'credit_line', NULL, true);
      IF NOT COALESCE((v_res->>'ok')::boolean, true) THEN RAISE EXCEPTION 'shift in failed %: %', r.user_id, v_res; END IF;
    END IF;
  END LOOP;

  -- Place links: credit line on -> credit line box, else main box. Never secondary.
  UPDATE public.ad_accounts a SET
    external_topup_url = CASE WHEN COALESCE(p.credit_line_wallet_enabled,false) THEN NULL ELSE e.link END,
    external_topup_url_credit_line = CASE WHEN COALESCE(p.credit_line_wallet_enabled,false) THEN e.link ELSE NULL END,
    external_topup_url_secondary = NULL
  FROM _ext e LEFT JOIN public.profiles p ON p.user_id=e.uid
  WHERE a.id=e.acct;
END $$;