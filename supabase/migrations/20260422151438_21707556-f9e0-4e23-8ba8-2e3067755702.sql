-- 1. tenant_chat_conversations
CREATE TABLE public.tenant_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_user_id text NOT NULL,
  tenant_user_name text,
  tenant_user_email text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  is_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tenant_user_id)
);
CREATE INDEX idx_tenant_chat_conv_tenant ON public.tenant_chat_conversations(tenant_id, last_message_at DESC);
ALTER TABLE public.tenant_chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant_chat_conversations"
  ON public.tenant_chat_conversations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- 2. tenant_chat_messages
CREATE TABLE public.tenant_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.tenant_chat_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_label text,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_chat_msg_conv ON public.tenant_chat_messages(conversation_id, created_at);
ALTER TABLE public.tenant_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant_chat_messages"
  ON public.tenant_chat_messages FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- 3. tenant_bm_share_requests
CREATE TABLE public.tenant_bm_share_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_user_id text NOT NULL,
  tenant_user_name text,
  ad_account_external_id text NOT NULL,
  ad_account_name text,
  bm_id text NOT NULL,
  bm_name text,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_notes text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_bm_share_status ON public.tenant_bm_share_requests(status, created_at DESC);
ALTER TABLE public.tenant_bm_share_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant_bm_share_requests"
  ON public.tenant_bm_share_requests FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- 4. tenant_withdraw_requests
CREATE TABLE public.tenant_withdraw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_user_id text NOT NULL,
  tenant_user_name text,
  ad_account_external_id text NOT NULL,
  ad_account_name text,
  amount_usd numeric NOT NULL DEFAULT 0,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_notes text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_withdraw_status ON public.tenant_withdraw_requests(status, created_at DESC);
ALTER TABLE public.tenant_withdraw_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant_withdraw_requests"
  ON public.tenant_withdraw_requests FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));