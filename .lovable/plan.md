## Goal

Tin ta problem ek shathe solve korbo:

1. **API call onek besi** — 364 acc er jonno ~1,200+ Meta call jacche (proti acc e 4 ta call: today+yesterday spend, account fields, payment cycle, campaigns).
2. **Sob acc update hoy na** — kichu acc "2-3 hours ago" theke jay.
3. **Update hole acc list 0 hoye jay** — reload korle fire ase, mane DB te data ache, UI te temporarily harano.
4. **Proxy set thakle force korte hobe** — ekhon proxy fail hole silently direct IP te chole jay (Facebook flag risk). User chan: proxy secret set thakle MUST proxy diye jaak.

---

## Changes

### 1. `supabase/functions/get-account-insights/index.ts` — Meta Batch API

Ekhon proti account er jonno 4 ta separate Meta call hoy. Notun e Meta-r native **`?batch=` POST endpoint** use korbo (ja `get-spend-only` te already kaj korche), jate **50 ta account = ~1 ta Meta HTTP call** (each batch internally 4 sub-requests/account, but counts as 1 outbound HTTP hit + 1 IP usage).

- BM access token diye group korbo (ekta batch e ekta token hoy).
- Per batch payload: each account er 4 ta relative_url (today+yesterday combined insights, account fields, payment cycle, active campaigns count).
- Batch size: **50 sub-requests-per-call max** (Meta limit). Mane proti batch e ~12 acc (4 sub-req × 12 = 48). Eta safer than packing 50 acc × 4 = 200 sub-req.
- Concurrency cap = **4** parallel batch (get-spend-only pattern).
- Existing single-account path retain korbo (jodi 1 ta acc thake, direct call), but multi-account = batch.

**Result**: 364 acc → ~30 batch HTTP call (vs 1,200+). Same data, ~10x kom call.

### 2. `src/lib/chunkedMetaSync.ts` — chunk 50, parallel proper, retry

- `CHUNK_SIZE: 30 → 50` (user request).
- `CONCURRENCY: 3` (rakhbo — edge function ekhon batch API use korbe so chunk size barano safe).
- Auto-retry layer rakhbo: failed acc gulo `RETRY_CHUNK_SIZE = 10` e abar 1-bar try.
- `MAX_CHUNK_RETRIES = 2` → 3 attempts per chunk.

### 3. `supabase/functions/_shared/meta-fetch.ts` — Proxy strict mode

Notun env flag: `META_PROXY_STRICT` (default `"true"` jodi `META_PROXY_SECRET` set thake).

- Jodi strict mode on AND proxy fail hoy → direct fallback **NOI**, instead `Response` return korbo with status 502 + body `{"error":"proxy_unhealthy:<reason>"}`. Caller (edge function) eta ke retry/rate-limit treat korbe.
- Jodi `META_PROXY_SECRET` **na set thake** → existing direct fetch behavior (current state — user pore set korbe).
- Counter & log untouched.

User je bolechen: "proxy api set kora thakle jeno must vercel proxy ip diye call jay" — eta exactly setai.

### 4. `src/components/admin/AdminAdAccounts.tsx` + `AdminDashboard.tsx` — accounts list 0 fix

Root cause: refresh-er por `queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] })` chalano hoy. Refetch chole, kintu jodi network slow/throttled hoy ar `placeholderData: keepPreviousData` thakao, **edge case**: `refetchInsights()` + accounts invalidate ek shathe race kore — insights query er `enabled: !!accounts && accounts.length > 0` briefly false hoye jay jodi accounts undefined fire ashe.

Fix:
- **Sync er por `["admin-ad-accounts"]` invalidate korbo NA** — accounts metadata (name, status, BM) sync e change hoy na, sudhu insights (spend/balance/cards) change hoy. Sudhu `["admin-insights-cache"]` invalidate / `refetchInsights()` korbo.
- `["billings-accounts"]` & `["billings-insights"]` invalidate thakbe (oi page e fresh data dorkar).
- Accounts list query e `placeholderData: keepPreviousData` already ache — protect korbe.
- Single-account refresh (`refreshSingleMutation`) o same — sudhu insights invalidate.

**Files**:
- `AdminAdAccounts.tsx`: `refreshAllMutation.onSuccess`, `refreshInventoryMutation.onSuccess`, `refreshSelectedMutation.onSuccess`, `refreshSingleMutation.onSuccess` — `["admin-ad-accounts"]` invalidate line remove.
- `AdminDashboard.tsx`: `handleUpdateFromMeta`, `handleFetchDailySpend` — same.

### 5. UI status text — already ache, untouched

`lastSyncStatus` display logic ekhonkar moto thakbe (`350/364 updated · 14 failed`).

---

## Expected result

| Metric | Ekhon | Notun |
|---|---|---|
| 364 acc er Meta HTTP call | ~1,260 | **~30** |
| Sync time | ~2-3 min | ~1-1.5 min |
| Stale acc (2-3 hrs ago) | jhama | almost 0 (auto-retry + bigger chunks) |
| Update er por acc list | 0 hoye jay | thik thakbe |
| Proxy set thakle | silent direct fallback | strict — proxy na holey error |

---

## Files touched

1. `supabase/functions/get-account-insights/index.ts` — Meta Batch API integration
2. `supabase/functions/_shared/meta-fetch.ts` — strict proxy mode
3. `src/lib/chunkedMetaSync.ts` — CHUNK_SIZE 50
4. `src/components/admin/AdminAdAccounts.tsx` — remove accounts list invalidate (4 mutations)
5. `src/components/admin/AdminDashboard.tsx` — remove accounts list invalidate (2 handlers)

## Out of scope

- Vercel-e proxy secret set kora — user nije korbe. Code ready thakbe.
- System logs entry — user explicitly no.
- Background queue — lagbe na.

Approve hole implement kore di.