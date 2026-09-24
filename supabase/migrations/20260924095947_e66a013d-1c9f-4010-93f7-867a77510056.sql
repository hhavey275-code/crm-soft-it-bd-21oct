ALTER TABLE public.external_topup_requests
  ADD COLUMN IF NOT EXISTS spend_cap_before numeric,
  ADD COLUMN IF NOT EXISTS spend_cap_after numeric,
  ADD COLUMN IF NOT EXISTS limit_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS manual_note text;

CREATE TABLE IF NOT EXISTS public.external_crm_status (
  crm_name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  message text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.external_crm_status TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.external_crm_status TO authenticated;
GRANT ALL ON public.external_crm_status TO service_role;
ALTER TABLE public.external_crm_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in reads crm status" ON public.external_crm_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage crm status" ON public.external_crm_status FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
ALTER PUBLICATION supabase_realtime ADD TABLE public.external_crm_status;

CREATE OR REPLACE FUNCTION public.ext_topup_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cap numeric; v_crm text; v_enabled boolean; v_msg text;
BEGIN
  SELECT spend_cap, COALESCE(external_crm_name, NEW.external_crm_name) INTO v_cap, v_crm
  FROM ad_accounts WHERE id = NEW.ad_account_id;
  IF NEW.spend_cap_before IS NULL THEN NEW.spend_cap_before := v_cap; END IF;
  v_crm := COALESCE(NEW.external_crm_name, v_crm);
  IF v_crm IS NOT NULL THEN
    SELECT enabled, message INTO v_enabled, v_msg FROM external_crm_status WHERE crm_name = v_crm;
    IF v_enabled = false AND NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'superadmin')) THEN
      RAISE EXCEPTION '%', COALESCE(NULLIF(v_msg,''), 'Top-up এখন সাময়িকভাবে বন্ধ আছে। কিছুক্ষণ পরে চেষ্টা করুন।');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ext_topup_before_insert ON public.external_topup_requests;
CREATE TRIGGER trg_ext_topup_before_insert BEFORE INSERT ON public.external_topup_requests
FOR EACH ROW EXECUTE FUNCTION public.ext_topup_before_insert();

CREATE OR REPLACE FUNCTION public.ext_topup_on_cap_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.spend_cap IS DISTINCT FROM OLD.spend_cap AND NEW.spend_cap IS NOT NULL THEN
    UPDATE external_topup_requests SET spend_cap_after = NEW.spend_cap, limit_status = 'updated'
    WHERE id = (
      SELECT id FROM external_topup_requests
      WHERE ad_account_id = NEW.id AND limit_status IN ('pending','not_updated')
        AND refunded_at IS NULL AND created_at > now() - interval '3 days'
        AND COALESCE(spend_cap_before, 0) < NEW.spend_cap
      ORDER BY created_at ASC LIMIT 1);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ext_topup_on_cap_change ON public.ad_accounts;
CREATE TRIGGER trg_ext_topup_on_cap_change AFTER UPDATE OF spend_cap ON public.ad_accounts
FOR EACH ROW EXECUTE FUNCTION public.ext_topup_on_cap_change();

CREATE OR REPLACE FUNCTION public.admin_mark_external_topup_manual(p_id uuid, p_new_cap numeric, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acc uuid;
BEGIN
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'superadmin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_new_cap IS NULL OR p_new_cap <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cap');
  END IF;
  UPDATE external_topup_requests SET spend_cap_after = p_new_cap, limit_status = 'manual',
    manual_note = p_note, status = 'completed', completed_by = auth.uid(),
    completed_at = COALESCE(completed_at, now()), last_error = NULL
  WHERE id = p_id RETURNING ad_account_id INTO v_acc;
  IF v_acc IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_mark_external_topup_manual(uuid, numeric, text) TO authenticated;

UPDATE public.external_topup_requests SET limit_status = 'not_updated'
WHERE limit_status = 'pending' AND created_at < now() - interval '1 day';