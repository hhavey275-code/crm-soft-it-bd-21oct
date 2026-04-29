## Goal
"Update all from Meta", Admin Dashboard er spend area, ar Spend Report — protita load er sesh e ekta choto line dekhabe: kotogula Meta API call holo ei action e (e.g. `Meta API calls: 12`).

## Data flow
Edge functions already counter rakhe (`getMetaProxyCount + getMetaDirectCount` from `supabase/functions/_shared/meta-fetch.ts`). Ekhon shudhu seta response e expose kore frontend e dekhate hobe.

## Changes

### 1. Edge functions — return call count
Both functions ekhono count kore but JSON response e pathay na.

- **`supabase/functions/get-spend-only/index.ts`**: response object e `meta_calls: { proxy, direct, total }` add koro (importing `getMetaProxyCount`, `getMetaDirectCount` already partially)
- **`supabase/functions/get-account-insights/index.ts`**: same vabe `meta_calls` field add koro response e (proxyCalls/directCalls already calculated at line 1096-1098, just include in JSON return at line 1118)

### 2. Client helpers — bubble up call count

- **`src/lib/fetchSpendOnly.ts`**: return type e `meta_calls: number` add koro. Internally each chunk er `data.meta_calls.total` jog koro.
- **`src/lib/chunkedMetaSync.ts`**: return e `meta_calls: number` add koro — protita chunk er response e `meta_calls.total` accumulate koro.

### 3. UI — show counter after each action

**a) Admin → Ad Accounts ("Update all from Meta" button)** (`src/components/admin/AdminAdAccounts.tsx`)
- `refreshAllMutation.onSuccess` e `data.meta_calls` capture kore state e rakho (`lastSyncCallCount`).
- Button er niche choto muted text:  
  `Last sync: {N} Meta API calls`  
  Shudhu mutation success hole show korbe. Pending hole "Updating..." dekhabe (already ache).
- Same pattern apply koro `refreshInventoryMutation` ar `refreshSelectedMutation` te (jodi user chai — common state).

**b) Client → Ad Accounts** (`src/components/client/ClientAdAccounts.tsx`) — same pattern, "Update All from Meta" button er niche.

**c) Admin Dashboard spend area** (`src/components/admin/AdminDashboard.tsx`)
- Date-range spend card er niche (after `handleFetchDateRangeSpend` complete): choto text `Meta API calls: {N}` — state variable `dateSpendCalls`.
- Monthly chart sync (`handleSyncMonthSpend`) er niche: same pattern, `monthSyncCalls`.

**d) Spend Report** (`src/components/pages/ClientSpendReportPage.tsx`)
- `fetchSpendOnly` er return e ekhon `meta_calls` thakbe.
- Page e date range data load hole, ekta choto line dekhabe (table er niche or filter er pashe):  
  `Meta API calls: {N}`

### Counter line styling
- `text-xs text-muted-foreground mt-1` — discreet, not distracting.
- Format: `Meta API calls: 6` (just the number — total proxy + direct).

## Files touched
1. `supabase/functions/get-spend-only/index.ts` — add `meta_calls` to response
2. `supabase/functions/get-account-insights/index.ts` — add `meta_calls` to response
3. `src/lib/fetchSpendOnly.ts` — accumulate + return `meta_calls`
4. `src/lib/chunkedMetaSync.ts` — accumulate + return `meta_calls`
5. `src/components/admin/AdminAdAccounts.tsx` — show counter under "Update all from Meta"
6. `src/components/client/ClientAdAccounts.tsx` — show counter under "Update All from Meta"
7. `src/components/admin/AdminDashboard.tsx` — show counter for date-range card + monthly chart
8. `src/components/pages/ClientSpendReportPage.tsx` — show counter after data load

## What stays untouched
- Proxy logic, batching, retries — kichu change na.
- "Update all from Meta" er actual behavior — same. Just added a small line under it.
- Other pages (BillingsPage, AdAccountDetailPage, etc.) — out of scope; user shudhu Spend Report + Dashboard + Update All button cheyeche.

Approve hole ami implement kore dichi.