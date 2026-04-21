

## Goal

Three problems to fix:
1. Top-up fail hole jeno automatic ar reliable fallback hoy (proxy → direct Meta).
2. Successful retry-er por jeno **kon IP theke top-up hoise** seta dekha jay (failed_topups + transactions e IP store + UI te show).
3. Ad Account details page reliably load + click korle smooth navigation.

---

## Plan

### 1. Stronger proxy → direct Meta fallback (all top-up edge functions)

Edit all 6 edge functions where `metaFetch` is used (`spend-cap-update`, `retry-failed-topup`, `get-account-insights`, `manage-ad-account-partners`, `scheduled-sync`, `sync-bm-accounts`, `rename-ad-account`):

- Trigger fallback to direct `fetch(graph.facebook.com, ...)` when proxy returns:
  - any non-2xx status (already done for 5xx — extend to ALL non-2xx including 4xx with proxy-shape JSON like `{"error":"Proxy not configured"}`)
  - HTML body
  - JSON body containing `{"error": "..."}` without a `data`/Meta-shaped payload (proxy-level error, not Meta error)
  - network exception / timeout (8s timeout via `AbortController`)
- Return a small marker on the `Response` (custom header `x-meta-route: proxy|direct`) so the caller can record which path was used.
- After successful Meta call, return that route info to the client in the JSON response (`via: "proxy" | "direct"`, plus the proxy/CF egress IP if available from response headers like `cf-connecting-ip` echo or proxy custom header).

### 2. IP / route tracking for top-ups

**DB migration**: add columns
- `failed_topups`: `last_attempt_via text`, `last_attempt_ip text`, `resolved_via text`, `resolved_ip text`, `resolved_at timestamptz`
- `transactions`: `via text` (proxy/direct), `source_ip text`

**Edge functions** (`spend-cap-update`, `retry-failed-topup`, `tiktok-topup`):
- After successful Meta POST, capture: `via` (proxy/direct), `source_ip` (from proxy response header `x-egress-ip` if proxy provides it; otherwise leave null for direct calls — Worker outbound IP isn't reliably exposed but we still record the route).
- On insert into `transactions`: include `via` + `source_ip`.
- On retry success: update `failed_topups` row with `resolved_via`, `resolved_ip`, `resolved_at`, `status='resolved'` (currently just deletes/marks resolved — keep history).
- On failure: write `last_attempt_via`, `last_attempt_ip` so the user can see what the failing attempt used.

**UI** (`FailedTopUps.tsx` + `TransactionsPage.tsx`):
- After retry success toast, also show: "Top-up via Proxy IP `1.2.3.4`" or "via Direct".
- In transactions table: add a small badge column "Source" → `Proxy (1.2.3.4)` / `Direct`.
- In failed top-ups list: show `Last attempt: via Proxy / IP x.x.x.x` under the error message, so user sees which path was tried.

### 3. Ad Account details page reliability

`AdAccountDetailPage.tsx`:
- Main render currently waits only on `account` query — that's fine. Real risk: `metaInsights` query throws when proxy fails → rendered as a broken state in MetricCards. Fix:
  - Wrap `get-account-insights` invoke in `try/catch`, return `null` insights on failure instead of throwing — page renders with "Insights unavailable, retry" button.
  - Add explicit `errorComponent` to route `ad-accounts.$id.tsx` so any unhandled error shows a friendly fallback with Retry, not a blank screen.
- AdminAdAccounts/ClientAdAccounts row click: confirm `navigate(\`/ad-accounts/${a.id}\`)` is not blocked by other onClick. Add `e.stopPropagation()` defensively where checkboxes/dropdowns sit inside the row, and ensure the row click only fires when target is the row container (skip when inside button/anchor) — prevents the "click karle kichu hocche na" symptom on rows with action menus.
- Add `Link` (TanStack) variant on the account-name cell for proper middle-click / right-click and so navigation works even if onClick fails.

---

## Technical Details

- Edge function fallback logic centralized in a `metaFetch` helper that returns `{ response, via, sourceIp }`.
- Proxy server (`app.softitbd.com/api/meta-proxy`) — request that the proxy include header `x-egress-ip: <ip>` on every successful response so we can log it. If unavailable, we still log `via=proxy` without IP.
- Direct Meta calls from Cloudflare Worker: outbound IP is not exposed by the Worker runtime, so `source_ip` will stay null for direct calls (we'll display "Direct (Cloudflare)" in UI).
- New DB columns are nullable so existing rows are unaffected.
- Realtime subscription on `failed_topups` already invalidates the UI list.

---

## Files Touched

- DB migration: `failed_topups`, `transactions` add nullable text columns.
- Edge: `spend-cap-update`, `retry-failed-topup`, `resolve-failed-topup`, `tiktok-topup`, `get-account-insights`, `manage-ad-account-partners`, `scheduled-sync`, `sync-bm-accounts`, `rename-ad-account` — update `metaFetch` + insert calls.
- `src/components/FailedTopUps.tsx` — show via/IP, success toast with IP.
- `src/components/pages/TransactionsPage.tsx` (+ admin/agency/client transaction tables) — Source column.
- `src/components/pages/AdAccountDetailPage.tsx` — graceful insights failure.
- `src/routes/ad-accounts.$id.tsx` — `errorComponent`.
- `src/components/admin/AdminAdAccounts.tsx`, `src/components/client/ClientAdAccounts.tsx` — defensive row click + Link wrapping for name cell.

---

## Out of Scope

- Fixing the actual `app.softitbd.com` proxy server (external — apnar server e thik korte hobe). Etake amra detect kore bypass korbo, kintu repair korbo na.
- Showing IP for direct (Worker) calls — runtime e expose hoy na.

