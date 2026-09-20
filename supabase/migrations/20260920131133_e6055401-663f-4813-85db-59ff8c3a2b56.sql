ALTER TABLE public.profiles ALTER COLUMN referral_enabled SET DEFAULT false;
UPDATE public.profiles SET referral_enabled = false WHERE referral_enabled IS DISTINCT FROM false;