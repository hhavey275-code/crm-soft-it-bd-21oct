-- Table to track pending BM invitations with intended ad-account permissions
CREATE TABLE IF NOT EXISTS public.bm_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_manager_id UUID NOT NULL REFERENCES public.business_managers(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  bm_role TEXT NOT NULL CHECK (bm_role IN ('ADMIN','EMPLOYEE')),
  -- Array of { ad_account_id (uuid), tasks: text[] }
  ad_account_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','permissions_applied','failed','cancelled')),
  meta_pending_user_id TEXT,
  meta_business_scoped_user_id TEXT,
  invited_by UUID,
  invite_response JSONB,
  permissions_apply_log JSONB,
  error_message TEXT,
  accepted_at TIMESTAMPTZ,
  permissions_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bm_invitations_bm ON public.bm_invitations(business_manager_id);
CREATE INDEX IF NOT EXISTS idx_bm_invitations_status ON public.bm_invitations(status);
CREATE INDEX IF NOT EXISTS idx_bm_invitations_email ON public.bm_invitations(invited_email);

ALTER TABLE public.bm_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all bm invitations"
ON public.bm_invitations FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE POLICY "Admins can insert bm invitations"
ON public.bm_invitations FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE POLICY "Admins can update bm invitations"
ON public.bm_invitations FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE POLICY "Admins can delete bm invitations"
ON public.bm_invitations FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

CREATE TRIGGER bm_invitations_updated_at
BEFORE UPDATE ON public.bm_invitations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();