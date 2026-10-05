CREATE TABLE public.facebook_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid text NOT NULL,
  password text,
  email text,
  email_password text,
  email_link text,
  two_fa_key text,
  note text,
  status text NOT NULL DEFAULT 'available',
  purchased_by uuid,
  purchased_at timestamptz,
  price_paid numeric,
  wallet_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facebook_profiles TO authenticated;
GRANT ALL ON public.facebook_profiles TO service_role;
ALTER TABLE public.facebook_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage profiles" ON public.facebook_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE POLICY "Buyers read own profiles" ON public.facebook_profiles FOR SELECT TO authenticated
  USING (purchased_by = auth.uid());
CREATE INDEX facebook_profiles_status_idx ON public.facebook_profiles(status, created_at);
CREATE TRIGGER update_facebook_profiles_updated_at BEFORE UPDATE ON public.facebook_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_profile_stock()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'available', (SELECT count(*) FROM public.facebook_profiles WHERE status='available'),
    'price', COALESCE((SELECT NULLIF(value,'')::numeric FROM public.site_settings WHERE key='profile_price_usd'), 0)
  )
$$;
GRANT EXECUTE ON FUNCTION public.get_profile_stock() TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_profiles(p_qty int, p_wallet_kind text DEFAULT 'primary')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_price numeric;
  v_kind text := CASE WHEN p_wallet_kind IN ('secondary','credit_line') THEN p_wallet_kind ELSE 'primary' END;
  v_ids uuid[];
  v_total numeric;
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
  v_res := public.adjust_wallet_atomic(v_user, -v_total, 'profile_purchase',
    'Profile purchase × ' || p_qty, 'client', v_kind, NULL, false);
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