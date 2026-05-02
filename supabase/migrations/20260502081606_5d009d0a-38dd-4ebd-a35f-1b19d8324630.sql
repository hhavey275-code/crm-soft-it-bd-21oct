
-- Per-seller Google Sheet sync configuration
CREATE TABLE public.seller_sheet_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL UNIQUE REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL,
  spreadsheet_url text,
  tab_pattern text NOT NULL DEFAULT '{MMMM-YYYY}',
  template_tab text,
  header_row int NOT NULL DEFAULT 1,
  data_start_row int NOT NULL DEFAULT 7,
  -- Cell mapping: which column letter holds which field
  col_datetime text,
  col_payment_bdt text,
  col_payo_usd text,
  col_payo_rate text,
  col_payo_bdt text,
  col_wise_usd text,
  col_wise_rate text,
  col_wise_bdt text,
  col_total text,
  col_due_adv text,
  col_txn_id text,
  col_description text,
  col_proof_url text,
  enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_sheet_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sheet config"
  ON public.seller_sheet_config
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE TRIGGER update_seller_sheet_config_updated_at
  BEFORE UPDATE ON public.seller_sheet_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Track which seller_transactions have been synced to which sheet row
CREATE TABLE public.sheet_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_transaction_id uuid NOT NULL REFERENCES public.seller_transactions(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL,
  tab_name text NOT NULL,
  row_number int,
  synced_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'success',
  error_message text
);

CREATE UNIQUE INDEX sheet_sync_log_txn_unique
  ON public.sheet_sync_log (seller_transaction_id);

ALTER TABLE public.sheet_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read sync log"
  ON public.sheet_sync_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Service role writes sync log"
  ON public.sheet_sync_log
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
