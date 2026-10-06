# Roadmap

## Open tasks
- [x] Hide Mark everywhere; show a Bengali voice invitation on sign-up and keep the microphone visible on mobile (2026-09-27).
- [x] Release CRM Helper v2.00 with verified package, reliable active status, and automatic post-top-up Meta cap refresh (2026-09-27).
- [x] Diagnose and fix Meta BM ad-account creation responses; make Helper show verified server connectivity instead of only saved-token status (2026-09-27).
- [x] External CRM "Limit বাড়েনি": show reason; client Retry (Meta check → else queue helper, once); admin Manually done → Meta check → else auto helper retry. No 2-min auto retry (2026-09-27).
- [x] Block Google/direct sign-ups from every protected page until full name, business name, phone, address, and monthly spend are complete (2026-09-26).
- [ ] Confirm Supabase project connection for remixed project (user asked to connect `crm soft it bd` — current env points to ref dhswrfzdqcavgmymllat). Blocker: confirm with user that ref matches `crm soft it bd`.
- [x] Update CRM_JOB_SECRET and GOOGLE_API_KEY (user submitted values via secure form, 2026-09-20).
- [ ] Update remaining 6 secrets (WHATSAPP_ACCESS_TOKEN, WHATSAPP_DEFAULT_COUNTRY_CODE, WHATSAPP_NOTIFY_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_LANG, WHATSAPP_TEMPLATE_NAME). Blocker: user said they will provide these later.
- [x] Credit Line wallet: due limit (admin control + client view), payment order Main → Credit Line → Secondary, invoice split row, client Main→Credit Line/Secondary transfer (2026-09-20).
- [x] Group Main, Secondary, Credit Line and Combined wallet summaries into one responsive row across client dashboard, Ad Accounts and admin client overview (2026-09-20).
- [x] Referral: per-client enable + taka (BDT) commission rate, hidden menu when off, ad-account wise $3000 monthly qualification with Meta "Update" fetch (2026-09-20).
- [x] Shared ad account step 1: client "My Pages" page request + admin "Managed Ads" assign/approve (2026-10-06).
- [ ] Shared ad account step 1b: automatic "Connect with Facebook" page login. Blocker: Meta App ID/secret with pages permissions.
- [x] Shared ad account step 2: page-filtered Campaigns/Ad Sets/Ads manager "My Ads" (2026-10-06). Custom audiences pending.
- [ ] Shared ad account step 3: cached batch insights sync + refresh cooldown.
- [ ] Shared ad account step 4: wallet budget guard, spend deduction, zero-balance auto-pause.
