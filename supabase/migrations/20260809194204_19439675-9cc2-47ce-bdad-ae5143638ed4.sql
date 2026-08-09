create or replace function public.settle_secondary_from_main(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_main numeric;
  v_sec numeric;
  v_move numeric;
begin
  select coalesce(secondary_wallet_enabled, false) into v_enabled
  from public.profiles where user_id = p_user_id;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('moved', 0, 'reason', 'secondary_disabled');
  end if;

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

  v_move := least(v_main, abs(v_sec));
  if v_move <= 0 then
    return jsonb_build_object('moved', 0, 'reason', 'nothing_to_settle');
  end if;

  update public.wallets set balance = balance - v_move where user_id = p_user_id;
  update public.secondary_wallets set balance = balance + v_move, updated_at = now() where user_id = p_user_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, processed_by, wallet_kind)
  values (p_user_id, 'adjustment', -v_move, v_main - v_move,
          'Deposit surplus moved to Secondary wallet', 'system', 'primary');

  insert into public.transactions (user_id, type, amount, balance_after, description, processed_by, wallet_kind)
  values (p_user_id, 'adjustment', v_move, v_sec + v_move,
          'Secondary wallet due settled from deposit', 'system', 'secondary');

  return jsonb_build_object('moved', v_move, 'main_after', v_main - v_move, 'secondary_after', v_sec + v_move);
end;
$$;

revoke all on function public.settle_secondary_from_main(uuid) from public;
grant execute on function public.settle_secondary_from_main(uuid) to service_role, authenticated;