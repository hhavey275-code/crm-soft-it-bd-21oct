
-- Recalculate the entire ledger for a tenant in chronological order.
-- For each row: apply its movement_type+amount_delta to the running (limit, used)
-- and write *_before / *_after / remaining_before / remaining_after.
-- Finally sync tenants.system_limit and total_used to the last computed values.
CREATE OR REPLACE FUNCTION public.recalculate_tenant_ledger(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  cur_limit numeric := 0;
  cur_used  numeric := 0;
  new_limit numeric;
  new_used  numeric;
  mt text;
  d  numeric;
BEGIN
  FOR r IN
    SELECT id, movement_type, amount_delta, created_at
    FROM tenant_limit_ledger
    WHERE tenant_id = p_tenant_id
    ORDER BY created_at ASC, id ASC
  LOOP
    mt := COALESCE(r.movement_type, '');
    d  := COALESCE(r.amount_delta, 0);
    new_limit := cur_limit;
    new_used  := cur_used;

    IF mt = 'limit_purchase'
       OR mt = 'limit_manual_increase'
       OR mt = 'limit_manual_decrease' THEN
      new_limit := cur_limit + d;
    ELSIF mt = 'limit_set' THEN
      new_limit := d;
    ELSIF mt = 'usage_topup' OR mt = 'report-usage' THEN
      new_used := cur_used + d;
    ELSIF mt = 'usage_refund' OR mt = 'refund-usage' THEN
      -- refund deltas may be stored either as positive amount to refund or negative
      -- normalize: subtract abs(d) from used
      new_used := cur_used - ABS(d);
    ELSE
      -- unknown type: no-op
      NULL;
    END IF;

    UPDATE tenant_limit_ledger
    SET system_limit_before = cur_limit,
        system_limit_after  = new_limit,
        total_used_before   = cur_used,
        total_used_after    = new_used,
        remaining_before    = cur_limit - cur_used,
        remaining_after     = new_limit - new_used
    WHERE id = r.id;

    cur_limit := new_limit;
    cur_used  := new_used;
  END LOOP;

  UPDATE tenants
  SET system_limit = cur_limit,
      total_used   = cur_used
  WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'final_system_limit', cur_limit,
    'final_total_used', cur_used,
    'remaining', cur_limit - cur_used
  );
END $$;

-- Update a single ledger row (amount_delta / movement_type / reason),
-- then re-run the full recalc so downstream rows + tenant stay consistent.
CREATE OR REPLACE FUNCTION public.update_ledger_entry(
  p_id uuid,
  p_amount_delta numeric,
  p_movement_type text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_limit_ledger WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Ledger entry not found'; END IF;

  UPDATE tenant_limit_ledger
  SET amount_delta  = p_amount_delta,
      movement_type = p_movement_type,
      reason        = COALESCE(p_reason, reason)
  WHERE id = p_id;

  RETURN public.recalculate_tenant_ledger(v_tenant);
END $$;

-- Delete a ledger row + recalc.
CREATE OR REPLACE FUNCTION public.delete_ledger_entry(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_limit_ledger WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Ledger entry not found'; END IF;
  DELETE FROM tenant_limit_ledger WHERE id = p_id;
  RETURN public.recalculate_tenant_ledger(v_tenant);
END $$;

GRANT EXECUTE ON FUNCTION public.recalculate_tenant_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ledger_entry(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_ledger_entry(uuid) TO authenticated;
