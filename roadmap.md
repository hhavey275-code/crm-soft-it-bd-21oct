# Roadmap

## Open tasks
- [x] Make My Ads Active/Had delivery filters consistent and add confirmed Meta deletion for campaigns, ad sets and ads. Fifteen filter, cache and existing permission/availability tests passed.
- [ ] Verify Active filtering and real Meta deletion while signed in. Blocker: external Supabase authentication unavailable in sandbox; /my-ads redirects to /auth. No live ads were deleted during testing.
- [x] Explain legitimate Meta app tester setup and its limits; current My Ads mutations still use saved BM credentials, not client Facebook consent tokens.
- [x] Request ads_management and ads_read in both client Facebook connection flows; existing OAuth callback auto-connects Pages for My Ads. Permission and availability tests: 9 passed.
- [ ] Verify Facebook consent → saved Page → campaign creation with a real client. Blocker: external Supabase session and client's Facebook consent unavailable in sandbox; Meta App Advanced Access/Live settings remain unverified.
- [x] Diagnose Softmatic/Branding Solution account rename failure and show the actual server error instead of generic non-2xx. Meta permission remains an owner-controlled blocker; rename logs also show an invalid placeholder proxy URL (2026-10-20).
- [x] Fix My Ads Create availability for Disabled/Unsettled and failed/pending status reads; refresh rechecks status. Seven availability tests pass.
- [ ] Verify My Ads Disabled account warning and blurred Create in the signed-in UI. Blocker: external Supabase session unavailable in sandbox; browser redirects to sign-in.
- [x] Hide Mark everywhere; show a Bengali voice invitation on sign-up and keep the microphone visible on mobile (2026-09-27).
- [x] Release CRM Helper v2.00 with verified package, reliable active status, and automatic post-top-up Meta cap refresh (2026-09-27).
- [x] Diagnose and fix Meta BM ad-account creation responses; make Helper show verified server connectivity instead of only saved-token status (2026-09-27).
- [x] External CRM "Limit বাড়েনি": show reason; client Retry (Meta check → else queue helper, once); admin Manually done → Meta check → else auto helper retry. No 2-min auto retry (2026-09-27).
- [x] Block Google/direct sign-ups from every protected page until full name, business name, phone, address, and monthly spend are complete (2026-09-26).
- [ ] Confirm Supabase project connection for remixed project (user asked to connect `crm soft it bd` — current env points to ref dhswrfzdqcavgmymllat). Blocker: awaiting user confirmation that ref dhswrfzdqcavgmymllat is the `crm soft it bd` project (2026-10-13).
- [ ] Re-enter secrets after remix: CRM_JOB_SECRET, GOOGLE_API_KEY, META_APP_ID, META_APP_SECRET, KAST_WEBHOOK_SECRET. Blocker: user will submit values via secure form.
- [x] WhatsApp secrets dropped — WhatsApp API not needed for this project (user decision 2026-10-13).
- [x] Credit Line wallet: due limit (admin control + client view), payment order Main → Credit Line → Secondary, invoice split row, client Main→Credit Line/Secondary transfer (2026-09-20).
- [x] Group Main, Secondary, Credit Line and Combined wallet summaries into one responsive row across client dashboard, Ad Accounts and admin client overview (2026-09-20).
- [x] Referral: per-client enable + taka (BDT) commission rate, hidden menu when off, ad-account wise $3000 monthly qualification with Meta "Update" fetch (2026-09-20).
- [x] Shared ad account step 1: client "My Pages" page request + admin "Managed Ads" assign/approve (2026-10-06).
- [ ] Shared ad account step 1b: automatic "Connect with Facebook" page login. Blocker: Meta App ID/secret with pages permissions.
- [x] Shared ad account step 2: page-filtered Campaigns/Ad Sets/Ads manager "My Ads" (2026-10-06). Custom audiences pending.
- [ ] Shared ad account step 3: cached batch insights sync + refresh cooldown.
- [x] Shared ad account step 4: wallet budget guard, 15-min spend deduction, auto-pause + admin thresholds (2026-10-06). Needs publish for the scheduler URL.
- [ ] Confirm whether Supabase ref dhswrfzdqcavgmymllat is the "crm soft it bd" project; if not, user connects it via Settings → General → External Supabase
- [x] WhatsApp secrets dropped from remix setup — user confirmed not needed (2026-10-22)
