
-- 1. company_documents table
CREATE TABLE public.company_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  title text NOT NULL,
  description text,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  expires_at date,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_documents TO authenticated;
GRANT ALL ON public.company_documents TO service_role;

ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;

-- Helper: vault owner check (email whitelist stored in site_settings)
CREATE OR REPLACE FUNCTION public.is_vault_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.site_settings s ON s.key = 'documents_vault_owner_email'
    WHERE p.user_id = _user_id
      AND lower(p.email) = lower(s.value)
  );
$$;

CREATE POLICY "Vault owner can view documents"
  ON public.company_documents FOR SELECT
  TO authenticated
  USING (public.is_vault_owner(auth.uid()));

CREATE POLICY "Vault owner can insert documents"
  ON public.company_documents FOR INSERT
  TO authenticated
  WITH CHECK (public.is_vault_owner(auth.uid()));

CREATE POLICY "Vault owner can update documents"
  ON public.company_documents FOR UPDATE
  TO authenticated
  USING (public.is_vault_owner(auth.uid()))
  WITH CHECK (public.is_vault_owner(auth.uid()));

CREATE POLICY "Vault owner can delete documents"
  ON public.company_documents FOR DELETE
  TO authenticated
  USING (public.is_vault_owner(auth.uid()));

-- updated_at trigger
CREATE TRIGGER update_company_documents_updated_at
  BEFORE UPDATE ON public.company_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. site_settings rows
INSERT INTO public.site_settings (key, value) VALUES
  ('documents_vault_owner_email', 'maksudurrahaman64@gmail.com'),
  ('documents_vault_password_hash', ''),
  ('documents_vault_categories', '["Articles of Incorporation","EIN Letter","TIN Certificate","BIN Certificate","Trade License","Tax Return","Bank Documents","Other"]')
ON CONFLICT (key) DO NOTHING;

-- 3. Storage policies for the private bucket (bucket created via storage tool)
CREATE POLICY "Vault owner can read files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'company-documents' AND public.is_vault_owner(auth.uid()));

CREATE POLICY "Vault owner can upload files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'company-documents' AND public.is_vault_owner(auth.uid()));

CREATE POLICY "Vault owner can update files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'company-documents' AND public.is_vault_owner(auth.uid()))
  WITH CHECK (bucket_id = 'company-documents' AND public.is_vault_owner(auth.uid()));

CREATE POLICY "Vault owner can delete files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'company-documents' AND public.is_vault_owner(auth.uid()));

CREATE INDEX idx_company_documents_category ON public.company_documents(category);
CREATE INDEX idx_company_documents_created_at ON public.company_documents(created_at DESC);
