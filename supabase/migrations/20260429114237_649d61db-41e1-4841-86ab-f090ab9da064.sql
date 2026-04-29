-- Seller monthly closings table for month-to-month carry-forward of Due/Advance balance
CREATE TABLE public.seller_monthly_closings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  opening_due_advance_bdt NUMERIC NOT NULL DEFAULT 0,
  month_bdt_in NUMERIC NOT NULL DEFAULT 0,
  month_client_bdt NUMERIC NOT NULL DEFAULT 0,
  month_usdt_given NUMERIC NOT NULL DEFAULT 0,
  month_converted_bdt NUMERIC NOT NULL DEFAULT 0,
  month_withdraw_bdt NUMERIC NOT NULL DEFAULT 0,
  closing_due_advance_bdt NUMERIC NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT true,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, year, month)
);

CREATE INDEX idx_seller_monthly_closings_seller ON public.seller_monthly_closings(seller_id, year DESC, month DESC);

ALTER TABLE public.seller_monthly_closings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage seller_monthly_closings"
ON public.seller_monthly_closings FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Superadmins can manage seller_monthly_closings"
ON public.seller_monthly_closings FOR ALL TO authenticated
USING (has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

CREATE TRIGGER update_seller_monthly_closings_updated_at
BEFORE UPDATE ON public.seller_monthly_closings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();