CREATE TABLE IF NOT EXISTS public.wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  kind text NOT NULL DEFAULT 'topup_approved',
  phone text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  claimed_by text,
  sent_at timestamptz,
  last_error text,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_messages TO authenticated;
GRANT ALL ON public.wa_messages TO service_role;

ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage wa messages"
ON public.wa_messages FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE INDEX IF NOT EXISTS idx_wa_messages_status_created ON public.wa_messages (status, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created ON public.wa_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS public.wa_notify_settings (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  template text NOT NULL DEFAULT '',
  num_value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.wa_notify_settings TO authenticated;
GRANT ALL ON public.wa_notify_settings TO service_role;

ALTER TABLE public.wa_notify_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage wa settings"
ON public.wa_notify_settings FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

INSERT INTO public.wa_notify_settings (key, enabled, template, num_value) VALUES
  ('topup_approved', false,
   E'Dear {{name}}, your top-up of {{amount}} has been approved. Your current wallet balance is {{balance}}.\n\nThank you for staying with Soft RTB. For any problem please contact our admin or send a message in the CRM.',
   NULL),
  ('gap_seconds', true, '', 45),
  ('daily_limit', true, '', 150)
ON CONFLICT (key) DO NOTHING;

CREATE TRIGGER wa_messages_updated_at
BEFORE UPDATE ON public.wa_messages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER wa_notify_settings_updated_at
BEFORE UPDATE ON public.wa_notify_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.wa_enqueue(
  p_user_id uuid,
  p_kind text,
  p_vars jsonb,
  p_dedupe text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set record;
  v_phone text;
  v_name text;
  v_body text;
  v_id uuid;
BEGIN
  SELECT * INTO v_set FROM public.wa_notify_settings WHERE key = p_kind;
  IF v_set.key IS NULL OR NOT v_set.enabled OR btrim(COALESCE(v_set.template, '')) = '' THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(btrim(COALESCE(p.phone, '')), ''),
         COALESCE(NULLIF(btrim(COALESCE(p.full_name, '')), ''), p.email, 'Client')
    INTO v_phone, v_name
  FROM public.profiles p WHERE p.user_id = p_user_id;

  IF v_phone IS NULL THEN
    RETURN NULL;
  END IF;

  v_body := v_set.template;
  v_body := replace(v_body, '{{name}}', v_name);
  v_body := replace(v_body, '{{amount}}', COALESCE(p_vars->>'amount', ''));
  v_body := replace(v_body, '{{balance}}', COALESCE(p_vars->>'balance', ''));

  INSERT INTO public.wa_messages (user_id, kind, phone, body, dedupe_key)
  VALUES (p_user_id, p_kind, v_phone, v_body,
          COALESCE(p_dedupe, p_kind || ':' || p_user_id::text || ':' || now()::text))
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_whatsapp_on_wallet_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'top_up' AND COALESCE(NEW.amount, 0) > 0 THEN
    BEGIN
      PERFORM public.wa_enqueue(
        NEW.user_id,
        'topup_approved',
        jsonb_build_object(
          'amount', '$' || to_char(COALESCE(NEW.amount, 0), 'FM999999990.00'),
          'balance', '$' || to_char(COALESCE(NEW.balance_after, 0), 'FM999999990.00')
        ),
        'topup_approved:' || NEW.id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'wa enqueue failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_on_wallet_topup ON public.transactions;
CREATE TRIGGER whatsapp_on_wallet_topup
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trigger_whatsapp_on_wallet_topup();