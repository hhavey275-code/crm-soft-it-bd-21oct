ALTER TABLE public.seller_sheet_config
  ADD COLUMN IF NOT EXISTS col_withdraw text,
  ADD COLUMN IF NOT EXISTS opening_balance_cell text;