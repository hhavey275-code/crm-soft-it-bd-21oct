CREATE OR REPLACE FUNCTION public.purchase_profiles(p_qty int, p_wallet_kind text DEFAULT 'primary')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_price numeric;
  v_kind text := CASE WHEN p_wallet_kind IN ('secondary','credit_line') THEN p_wallet_kind ELSE 'primary' END;
  v_ids uuid[];
  v_total numeric;
  v_balance numeric;
  v_due numeric;
  v_res jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_signed_in'); END IF;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 100 THEN RETURN jsonb_build_object('ok',false,'error','invalid_quantity'); END IF;
  SELECT NULLIF(value,'')::numeric INTO v_price FROM public.site_settings WHERE key='profile_price_usd';
  IF v_price IS NULL OR v_price <= 0 THEN RETURN jsonb_build_object('ok',false,'error','price_not_set'); END IF;

  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM public.facebook_profiles WHERE status='available'
    ORDER BY created_at LIMIT p_qty FOR UPDATE SKIP LOCKED) s;
  IF v_ids IS NULL OR array_length(v_ids,1) < p_qty THEN
    RETURN jsonb_build_object('ok',false,'error','not_enough_stock','available',COALESCE(array_length(v_ids,1),0));
  END IF;

  v_total := round(v_price * p_qty, 2);

  -- Lock the wallet row and allow spending into the client's due limit
  IF v_kind = 'secondary' THEN
    SELECT balance INTO v_balance FROM public.secondary_wallets WHERE user_id=v_user FOR UPDATE;
  ELSIF v_kind = 'credit_line' THEN
    SELECT balance INTO v_balance FROM public.credit_line_wallets WHERE user_id=v_user FOR UPDATE;
  ELSE
    SELECT balance INTO v_balance FROM public.wallets WHERE user_id=v_user FOR UPDATE;
  END IF;
  v_due := COALESCE(public.effective_due_limit(v_user, v_kind), 0);
  IF COALESCE(v_balance,0) + v_due < v_total - 0.001 THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_balance','balance',COALESCE(v_balance,0),'due_limit',v_due);
  END IF;

  v_res := public.adjust_wallet_atomic(v_user, -v_total, 'profile_purchase',
    'Profile purchase × ' || p_qty, 'client', v_kind, NULL, true);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok',false,'error',COALESCE(v_res->>'error','wallet_error'));
  END IF;

  UPDATE public.facebook_profiles SET status='purchased', purchased_by=v_user,
    purchased_at=now(), price_paid=v_price, wallet_kind=v_kind
  WHERE id = ANY(v_ids);
  RETURN jsonb_build_object('ok',true,'count',p_qty,'total',v_total);
END $$;
REVOKE EXECUTE ON FUNCTION public.purchase_profiles(int, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.purchase_profiles(int, text) TO authenticated;