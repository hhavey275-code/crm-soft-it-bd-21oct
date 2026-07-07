## Update project secrets

Open a single secure form so you can paste new values for these 9 secrets. Values you leave blank stay unchanged; the rest you said you'll provide later.

**Secrets to update:**
1. `USER_GEMINI_API_KEY` — Gemini API key (starts with `AIza`)
2. `META_PROXY_URL` — Meta proxy base URL (https://…)
3. `OPENAI_API_KEY` — OpenAI key (starts with `sk-`)
4. `STRIPE_SECRET_KEY` — Stripe secret (`sk_live_…` / `sk_test_…`)
5. `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (`whsec_…`)
6. `VAPID_PRIVATE_KEY` — Web-push VAPID private key
7. `VAPID_SUBJECT` — VAPID subject (`mailto:you@domain`)
8. `SB_MGMT_PAT` — Supabase Management API PAT (`sbp_…`)
9. `META_PROXY_SECRET` — Shared secret for Meta proxy auth

No code changes — only secret values are rotated. All 9 already exist in the project; this just replaces the stored values.