-- Add stripe_customer_id to profiles for persistent Stripe Customer reuse
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
  ON public.profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Stripe payment links table
CREATE TABLE IF NOT EXISTS public.stripe_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  currency text NOT NULL DEFAULT 'usd',
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  checkout_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','expired','canceled')),
  failure_code text,
  failure_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_links_target ON public.stripe_payment_links(target_user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_links_status ON public.stripe_payment_links(status);
CREATE INDEX IF NOT EXISTS idx_stripe_links_session ON public.stripe_payment_links(stripe_session_id);

ALTER TABLE public.stripe_payment_links ENABLE ROW LEVEL SECURITY;

-- Admins/Superadmins can view all
CREATE POLICY "Admins view all stripe links"
  ON public.stripe_payment_links FOR SELECT
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- Admins/Superadmins can create
CREATE POLICY "Admins create stripe links"
  ON public.stripe_payment_links FOR INSERT
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
    AND created_by = auth.uid()
  );

-- Admins/Superadmins can update (e.g., cancel)
CREATE POLICY "Admins update stripe links"
  ON public.stripe_payment_links FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- Target user can view their own paid links (for receipt visibility, optional)
CREATE POLICY "Users view own stripe links"
  ON public.stripe_payment_links FOR SELECT
  USING (target_user_id = auth.uid());

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_stripe_links_updated_at ON public.stripe_payment_links;
CREATE TRIGGER update_stripe_links_updated_at
  BEFORE UPDATE ON public.stripe_payment_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();