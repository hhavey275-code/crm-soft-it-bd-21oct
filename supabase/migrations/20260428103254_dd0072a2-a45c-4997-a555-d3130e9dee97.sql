UPDATE public.bank_accounts
SET telegram_group_id = '-1003941583285'
WHERE telegram_group_id = '-5243496288';

INSERT INTO public.site_settings (key, value)
VALUES ('telegram_forward_group_id', '-1003941583285')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;