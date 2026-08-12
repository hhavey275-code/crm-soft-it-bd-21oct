DO $$
DECLARE v jsonb;
BEGIN
  v := public.credit_missing_approved_topup('afc4753f-012d-4d6d-ba5e-896a87b627e5','manual-repair-sanjidul');
  INSERT INTO public.system_logs (user_name, action, details)
  VALUES ('system', 'wallet_repair', 'Credited missing approved top-up for Md sanjidul alam (3900 BDT / $30): ' || v::text);
END $$;