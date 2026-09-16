ALTER TABLE public.external_topup_requests
  ADD COLUMN IF NOT EXISTS requested_by_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

GRANT SELECT, INSERT ON public.external_topup_requests TO authenticated;

DROP POLICY IF EXISTS "Clients view own external topup requests" ON public.external_topup_requests;
CREATE POLICY "Clients view own external topup requests"
ON public.external_topup_requests FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_etr_status_created ON public.external_topup_requests (status, created_at DESC);

-- Client requests an external CRM top-up (wallet deducted immediately)
CREATE OR REPLACE FUNCTION public.request_external_topup(
  p_ad_account_id uuid,
  p_amount numeric,
  p_wallet_kind text DEFAULT 'primary'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text := CASE WHEN p_wallet_kind = 'secondary' THEN 'secondary' ELSE 'primary' END;
  v_acc record;
  v_url text;
  v_balance numeric := 0;
  v_due numeric := 0;
  v_req_id uuid;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  SELECT * INTO v_acc FROM public.ad_accounts WHERE id = p_ad_account_id;
  IF v_acc.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_ad_accounts
    WHERE ad_account_id = p_ad_account_id AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_assigned');
  END IF;

  IF NOT COALESCE(v_acc.external_topup_required, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_external_account');
  END IF;

  v_url := CASE WHEN v_kind = 'secondary'
                THEN COALESCE(v_acc.external_topup_url_secondary, v_acc.external_topup_url)
                ELSE v_acc.external_topup_url END;
  IF v_url IS NULL OR btrim(v_url) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_url_not_configured');
  END IF;

  SELECT COALESCE(due_limit, 0) INTO v_due FROM public.profiles WHERE user_id = v_uid;
  v_due := COALESCE(v_due, 0);

  IF v_kind = 'secondary' THEN
    SELECT COALESCE(balance, 0) INTO v_balance FROM public.secondary_wallets WHERE user_id = v_uid;
  ELSE
    SELECT COALESCE(balance, 0) INTO v_balance FROM public.wallets WHERE user_id = v_uid;
  END IF;
  v_balance := COALESCE(v_balance, 0);

  IF p_amount > v_balance + v_due + 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance',
      'balance', v_balance, 'due_limit', v_due);
  END IF;

  INSERT INTO public.external_topup_requests (
    ad_account_id, user_id, amount, status, initiated_by, wallet_kind,
    requested_by_client, wallet_deducted, external_crm_name, external_topup_url
  ) VALUES (
    p_ad_account_id, v_uid, p_amount, 'pending', v_uid, v_kind,
    true, true, COALESCE(v_acc.external_crm_name, 'External CRM'), v_url
  ) RETURNING id INTO v_req_id;

  v_res := public.adjust_wallet_atomic(
    p_user_id => v_uid,
    p_amount => -p_amount,
    p_type => 'external_topup_request',
    p_description => 'External CRM top-up request — ' || COALESCE(v_acc.account_name, v_acc.account_id)
                     || ' [' || CASE WHEN v_kind = 'secondary' THEN 'Secondary wallet' ELSE 'Main wallet' END || ']',
    p_processed_by => 'client:' || v_uid::text,
    p_wallet_kind => v_kind,
    p_reference_id => v_req_id,
    p_allow_negative => true
  );

  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    DELETE FROM public.external_topup_requests WHERE id = v_req_id;
    RETURN jsonb_build_object('ok', false, 'error', COALESCE(v_res->>'error', 'wallet_deduction_failed'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'request_id', v_req_id,
    'balance_after', v_res->>'balance_after', 'url', v_url);
END;
$$;

REVOKE ALL ON FUNCTION public.request_external_topup(uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_external_topup(uuid, numeric, text) TO authenticated;

-- Admin marks a request completed
CREATE OR REPLACE FUNCTION public.complete_external_topup(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
BEGIN
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'superadmin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM public.external_topup_requests WHERE id = p_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.external_topup_requests
     SET status = 'completed', completed_by = v_uid, completed_at = now(), updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_external_topup(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.complete_external_topup(uuid) TO authenticated;

-- Admin rejects a request and refunds the wallet (idempotent)
CREATE OR REPLACE FUNCTION public.reject_external_topup(p_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_res jsonb;
BEGIN
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'superadmin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM public.external_topup_requests WHERE id = p_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status = 'rejected' THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE public.external_topup_requests
     SET status = 'rejected', rejected_by = v_uid, rejected_at = now(),
         admin_note = COALESCE(p_note, admin_note), updated_at = now()
   WHERE id = p_id;

  IF COALESCE(v_req.wallet_deducted, false) AND v_req.refunded_at IS NULL AND v_req.user_id IS NOT NULL THEN
    v_res := public.adjust_wallet_atomic(
      p_user_id => v_req.user_id,
      p_amount => v_req.amount,
      p_type => 'external_topup_refund',
      p_description => 'Refund — rejected external CRM top-up request',
      p_processed_by => 'admin:' || v_uid::text,
      p_wallet_kind => COALESCE(v_req.wallet_kind, 'primary'),
      p_reference_id => v_req.id,
      p_allow_negative => true
    );
    IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
      RAISE EXCEPTION 'refund_failed: %', COALESCE(v_res->>'error', 'unknown');
    END IF;
    UPDATE public.external_topup_requests
       SET refunded_at = now(), wallet_deducted = false, updated_at = now()
     WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_external_topup(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reject_external_topup(uuid, text) TO authenticated;

-- Notify admins on new client-submitted request
CREATE OR REPLACE FUNCTION public.notify_admins_on_external_topup_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND COALESCE(NEW.requested_by_client, false) THEN
    INSERT INTO public.notifications (user_id, type, title, message, reference_id)
    SELECT ur.user_id, 'external_topup_request', 'New External Top-Up Request',
      'A client requested $' || NEW.amount::text || ' external CRM top-up',
      NEW.id
    FROM public.user_roles ur WHERE ur.role IN ('admin', 'superadmin');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_external_topup ON public.external_topup_requests;
CREATE TRIGGER trg_notify_admins_external_topup
AFTER INSERT ON public.external_topup_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_admins_on_external_topup_request();