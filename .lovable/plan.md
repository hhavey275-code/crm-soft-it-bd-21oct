## Goal
1. Spend Report ar Admin Dashboard er date-range spend cache theke noy — **proti bar live Meta theke fetch** korbe (jate counter o thik dekhabe ar real-time data ashe).
2. Protita spend check action **system_logs** e likhbe — admin name, action, kotogula account, date range, total Meta API calls, proxy IP shoho. (Same pattern jeta `get-account-insights` already kore.)

## Changes

### 1. `supabase/functions/get-spend-only/index.ts` — system log add
Just like `get-account-insights` does at line 1080-1112, add at the end of handler:
- Read caller `user_id` from JWT (`Authorization` header) → lookup `profiles.full_name / email` → `userName`.
- Insert into `system_logs`:
  - **action**: `"Meta Spend Check"`
  - **details**: `"Checked spend for N account(s) [range=YYYY-MM-DD..YYYY-MM-DD] | calls=X (proxy=P, direct=D) | proxy_ip=..."`
  - **user_id / user_name**: from caller
- Wrap in try/catch (same as existing function) so log failure never breaks the response.
- Continue returning `meta_calls` in response (already done).

### 2. `src/lib/fetchSpendOnly.ts` — no cache
Already fine (no internal cache). Caller controls cache via React Query.

### 3. `src/components/pages/ClientSpendReportPage.tsx` — disable cache for date-range query
Current: `staleTime: 0` but React Query still serves cached data instantly while refetching in the background → `queryFn` may not run when filters unchanged.

Change date-range query options to:
- `staleTime: 0`
- `gcTime: 0` (drop cache immediately)
- `refetchOnMount: "always"`
- `refetchOnWindowFocus: false` (avoid surprise refetches)

This guarantees: every time user lands on the page or changes date → fresh Meta call → counter updates correctly.

Also: store `metaCalls` from query data, not separate state. Do this by returning `{ rows, meta_calls }` from `queryFn` and reading `metaRows?.meta_calls` directly. Removes the stale `null` after navigation.

### 4. `src/components/admin/AdminDashboard.tsx` — same for date-range card
`handleFetchDateRangeSpend` already runs only on button click (no cache issue). But:
- Currently writes spend to `sessionStorage` and reads on mount → that's why old number shows with "0 calls" after reload.
- Fix: when reading from `sessionStorage`, set `dateSpendCalls` to `null` AND show a small `(cached — click date to refetch live)` hint next to the number. This way user knows it's not a fresh call.
- New live fetch via the button updates both spend + counter as today.

### 5. Show proxy IP in UI counter (optional but helpful)
Edge function already returns `meta_calls.total`. Extend response to include `proxy_ip` (already tracked via `getLastMetaIp()`). UI counter line becomes:
- `Meta API calls: 7 (via proxy IP 1.2.3.4)` — when proxy used
- `Meta API calls: 7 (direct)` — when proxy fallback happened

Files: `get-spend-only/index.ts` (add `proxy_ip` to response), `fetchSpendOnly.ts` (bubble up), and the 3 UI files (`AdminDashboard.tsx`, `ClientSpendReportPage.tsx`, `AdminAdAccounts.tsx` + `ClientAdAccounts.tsx`) to display it.

## Files touched
1. `supabase/functions/get-spend-only/index.ts` — add system_logs insert + `proxy_ip` in response
2. `src/lib/fetchSpendOnly.ts` — return `proxy_ip` along with `meta_calls`
3. `src/components/pages/ClientSpendReportPage.tsx` — disable cache, show counter from query data, show proxy IP
4. `src/components/admin/AdminDashboard.tsx` — show "(cached)" hint when restored from sessionStorage, show proxy IP after live fetch
5. `src/components/admin/AdminAdAccounts.tsx` + `src/components/client/ClientAdAccounts.tsx` — show proxy IP next to existing counter

## Out of scope
- Realtime subscription on a `spend_data` table — we don't store per-account spend in a table; spend is fetched live from Meta. Disabling React Query cache (above) achieves the "always live" behavior you want without needing Supabase realtime.
- `get-account-insights` already logs to system_logs (no change needed).
- Other pages that don't show spend.

Approve hole implement kore di.