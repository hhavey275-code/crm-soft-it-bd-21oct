INSERT INTO public.site_settings (key, value)
VALUES ('ocr_fallback_priority', '["gemini","lovable","openai"]'::text)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;