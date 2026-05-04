
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);

CREATE TABLE IF NOT EXISTS public.stripe_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  amount_usd numeric NOT NULL CHECK (amount_usd > 0),
  stripe_session_id text UNIQUE,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  checkout_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','expired','canceled')),
  failure_code text,
  failure_message text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spl_target_user ON public.stripe_payment_links(target_user_id);
CREATE INDEX IF NOT EXISTS idx_spl_status ON public.stripe_payment_links(status);
CREATE INDEX IF NOT EXISTS idx_spl_session ON public.stripe_payment_links(stripe_session_id);

ALTER TABLE public.stripe_payment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all stripe payment links"
ON public.stripe_payment_links FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE POLICY "Admins can insert stripe payment links"
ON public.stripe_payment_links FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE POLICY "Admins can update stripe payment links"
ON public.stripe_payment_links FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE TRIGGER update_stripe_payment_links_updated_at
BEFORE UPDATE ON public.stripe_payment_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
