CREATE OR REPLACE FUNCTION public.settle_secondary_from_main(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled boolean;
  v_main numeric;
  v_sec numeric;
  v_main_rate numeric;
  v_sec_rate numeric;
  v_site_rate numeric;
  v_move numeric;      -- USD taken out of main wallet
  v_credit numeric;    -- USD credited to secondary wallet (rate converted)
begin
  select coalesce(secondary_wallet_enabled, false),
         nullif(usd_rate, 0),
         nullif(secondary_usd_rate, 0)
    into v_enabled, v_main_rate, v_sec_rate
  from public.profiles where user_id = p_user_id;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('moved', 0, 'reason', 'secondary_disabled');
  end if;

  select nullif((value)::numeric, 0) into v_site_rate
  from public.site_settings where key = 'usd_rate';

  v_main_rate := coalesce(v_main_rate, v_site_rate, v_sec_rate);
  v_sec_rate  := coalesce(v_sec_rate, v_main_rate);

  select balance into v_main from public.wallets where user_id = p_user_id for update;
  select balance into v_sec from public.secondary_wallets where user_id = p_user_id for update;

  if v_main is null then
    return jsonb_build_object('moved', 0, 'reason', 'no_main_wallet');
  end if;
  if v_sec is null then
    insert into public.secondary_wallets (user_id, balance) values (p_user_id, 0)
    on conflict (user_id) do nothing;
    v_sec := 0;
  end if;

  if v_main <= 0 or v_sec >= 0 then
    return jsonb_build_object('moved', 0, 'reason', 'nothing_to_settle');
  end if;

  if coalesce(v_main_rate, 0) <= 0 or coalesce(v_sec_rate, 0) <= 0 then
    -- no usable rates: fall back to legacy 1:1 behaviour
    v_main_rate := 1;
    v_sec_rate := 1;
  end if;

  -- USD needed from main to fully clear the secondary due, in BDT-equivalent terms
  v_move := round(least(v_main, abs(v_sec) * v_sec_rate / v_main_rate), 2);
  if v_move <= 0 then
    return jsonb_build_object('moved', 0, 'reason', 'nothing_to_settle');
  end if;

  v_credit := round(v_move * v_main_rate / v_sec_rate, 2);
  if v_credit > abs(v_sec) then
    v_credit := abs(v_sec);
  end if;

  update public.wallets set balance = balance - v_move where user_id = p_user_id;
  update public.secondary_wallets set balance = balance + v_credit, updated_at = now() where user_id = p_user_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, processed_by, wallet_kind)
  values (p_user_id, 'adjustment', -v_move, v_main - v_move,
          'Deposit surplus moved to Secondary wallet (rate ' || v_main_rate || ' -> ' || v_sec_rate || ')', 'system', 'primary');

  insert into public.transactions (user_id, type, amount, balance_after, description, processed_by, wallet_kind)
  values (p_user_id, 'adjustment', v_credit, v_sec + v_credit,
          'Secondary wallet due settled from deposit (rate converted)', 'system', 'secondary');

  return jsonb_build_object('moved', v_move, 'credited', v_credit,
    'main_rate', v_main_rate, 'secondary_rate', v_sec_rate,
    'main_after', v_main - v_move, 'secondary_after', v_sec + v_credit);
end;
$function$;