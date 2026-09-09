ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS external_topup_url_secondary text;
ALTER TABLE public.external_topup_requests ADD COLUMN IF NOT EXISTS wallet_kind text NOT NULL DEFAULT 'primary';
ALTER TABLE public.external_topup_requests DROP CONSTRAINT IF EXISTS external_topup_requests_wallet_kind_check;
ALTER TABLE public.external_topup_requests ADD CONSTRAINT external_topup_requests_wallet_kind_check CHECK (wallet_kind IN ('primary','secondary'));