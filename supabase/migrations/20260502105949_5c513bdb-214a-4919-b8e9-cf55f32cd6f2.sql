DROP TRIGGER IF EXISTS sync_seller_transaction_for_approved_topup_trigger ON public.top_up_requests;
DROP TRIGGER IF EXISTS trg_purge_rejected_seller_txn ON public.seller_transactions;
DROP TRIGGER IF EXISTS trg_purge_rejected_seller_txn_ins ON public.seller_transactions;

CREATE OR REPLACE FUNCTION public.claim_forward_slot(
  p_source_type text,
  p_source_id   uuid,
  p_group_id    text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted int;
BEGIN
  INSERT INTO public.telegram_forward_log (source_type, source_id, telegram_group_id, telegram_message_id, caption_total_bdt)
  VALUES (p_source_type, p_source_id, p_group_id, NULL, NULL)
  ON CONFLICT (source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_forward_slot(
  p_source_type   text,
  p_source_id     uuid,
  p_message_id    bigint,
  p_caption_total numeric
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.telegram_forward_log
     SET telegram_message_id = p_message_id,
         caption_total_bdt   = p_caption_total
   WHERE source_type = p_source_type
     AND source_id   = p_source_id;
$$;

CREATE OR REPLACE FUNCTION public.release_forward_slot(
  p_source_type text,
  p_source_id   uuid
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.telegram_forward_log
   WHERE source_type = p_source_type
     AND source_id   = p_source_id
     AND telegram_message_id IS NULL;
$$;