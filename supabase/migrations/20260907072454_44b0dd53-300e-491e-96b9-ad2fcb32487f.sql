CREATE TABLE public.custom_invoices (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  invoice_number text not null,
  template text not null default 'classic',
  currency text not null default 'USD',
  issue_date date not null default current_date,
  due_date date,
  logo_url text,
  from_name text,
  from_address text,
  from_email text,
  from_phone text,
  from_extra text,
  bank_details text,
  to_name text,
  to_address text,
  to_email text,
  to_phone text,
  items jsonb not null default '[]'::jsonb,
  tax_percent numeric not null default 0,
  discount numeric not null default 0,
  notes text,
  terms text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_invoices TO authenticated;
GRANT ALL ON public.custom_invoices TO service_role;

ALTER TABLE public.custom_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage custom invoices"
ON public.custom_invoices FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE TRIGGER update_custom_invoices_updated_at
BEFORE UPDATE ON public.custom_invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_custom_invoices_created_by ON public.custom_invoices(created_by, created_at DESC);