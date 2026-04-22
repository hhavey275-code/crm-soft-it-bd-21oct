

## Top-Up Flow + Sync/Logging Fixes

Goal: make the top-up flow truly safe (wallet → API → verify → DB), fix the misleading "Last synced" timestamp, log every Meta call (insights / date-range / dashboard) with caller + IP into System Logs, and fix the wrong "Total" line in the Telegram message that goes out when a **client top-up** is approved.

---

### 1. Top-Up Flow — wallet first, then verify with GET (already mostly there, but broken)

Current `spend-cap-update` already follows: deduct wallet → POST → if POST fails do GET-verify → on real success, write DB; on failure, refund-less "Failed Top-Up" entry. But it has bugs that make perfectly successful top-ups land in **Failed Top-Ups**, and other times silently mark fake successes:

What we will do in `supabase/functions/spend-cap-update/index.ts`:

1. **Always GET-verify after POST**, both on POST-success and POST-error paths. Today the success path trusts the POST response and skips a verify GET in some branches; the error path verifies. We unify it: after POST, *always* fetch `?fields=spend_cap` and compare `centsToDollars(metaCap) ≈ oldCap + amount` with a small tolerance (≥ amount − $0.02). Only then mark success.
2. **Treat "GET shows the new cap" as the source of truth.** If POST returned an error but GET confirms the new cap → success (already done). If POST returned success but GET still shows the old cap → push to `failed_topups` instead of marking success (this is the "client top-up succeeded but spend cap didn't actually update" case the user described).
3. Fix the broken `lastMetaProxyIp` references (the file uses `lastMetaIp` but logs `lastMetaProxyIp` → currently throws ReferenceError on every failure path, which is partly why "Failed" toasts appear even when the cap updated). Rename consistently to `lastMetaIp` and include `via` (proxy/direct) in every log line.
4. Wrap the whole flow in clear ordered steps with comments: `(1) Deduct wallet → (2) POST spend_cap → (3) GET verify → (4a) success: update ad_accounts + log + health-check → (4b) failure: insert failed_topups + log` — no early-exit success without a verify.

---

### 2. "Update All from Meta" timestamp showing 23h ago

In `src/components/client/ClientAdAccounts.tsx` the displayed "Last synced" uses `Math.min(...updated_at)` — so a single never-refreshed account drags the label back to its old time even when most accounts updated 3h ago.

Fix: use `Math.max(...updated_at)` (latest sync wins). Also make the post-refresh `refetchInsights()` actually re-read from the DB (force `staleTime: 0` for that one query invalidation) so the label updates immediately after the button finishes.

Apply the same `Math.max` fix anywhere else this pattern exists (admin & agency lists if present).

---

### 3. Log every Meta call into System Logs (caller + IP + which call)

Today only `spend-cap-update` writes to `system_logs`. Insights refresh, date-range dashboard fetches, and "Update All from Meta" don't — so the user can't see who pulled data, when, or from which IP.

Changes in `supabase/functions/get-account-insights/index.ts`:

1. Add a single `logMetaCall(supabase, {userId, userName, action, details, ip, via})` helper that inserts into `system_logs`.
2. After each request, write **one** row capturing:
   - action: `"Meta Insights Refresh"` (live source) or `"Meta Insights Cache Read"` (cache source) or `"Meta Date-Range Fetch"` when a `since/until` window is passed.
   - details: `N accounts · since=YYYY-MM-DD until=YYYY-MM-DD · via=proxy · IP: 1.2.3.4` plus a comma-joined short list of account names (truncated).
   - resolve `userId/userName` from the auth token (same `getClaims` pattern already used in spend-cap-update).
3. Fix the same dangling `lastMetaProxyIp` symbol bug here (declare `let lastMetaIp = null; let lastMetaVia = "direct";` and update `metaFetch` to set them).

Now System Logs will show: who clicked "Update All from Meta", who opened a date-range view on the dashboard, what IP Meta saw, and how many accounts/which window — covering every Meta API call, not just spend-cap.

---

### 4. Telegram total wrong on **client_topup** forward

OCR (manual seller payment) sends the proof through `forward-seller-proof`, which correctly recomputes the seller's running Due/Advance and appends the right "Total" line.

But when an admin approves a client top-up in `AdminTopUp.tsx`, the proof is forwarded via a different function (`forward-proof`) that does *not* recompute the seller balance — so the SMS-style message in Telegram shows a wrong total.

Fix: after the client_topup `seller_transactions` row is inserted in `AdminTopUp.tsx` (lines ~439–453), also call `forward-seller-proof` (the function that already computes Due/Advance correctly) for the seller, instead of relying solely on `forward-proof`. Pass `seller_id`, `bdt_amount`, `bank_account_id`, `reference`, and the proof URL. This way both OCR and client-topup paths produce the same correct "Total: Advance/Due ৳X" line.

Keep the existing `forward-proof` call for the bank-group image forward (that one is a different per-bank Telegram group and doesn't need a Total line). Only the seller-Total message gets re-routed through `forward-seller-proof`.

---

### Technical summary (files touched)

- `supabase/functions/spend-cap-update/index.ts`
  - Unify "always GET-verify after POST"; treat GET as source of truth.
  - Fix `lastMetaProxyIp` → `lastMetaIp`; include `via` (proxy/direct) in all log details.
- `supabase/functions/get-account-insights/index.ts`
  - Declare `lastMetaIp` / `lastMetaVia`, capture per-request.
  - Resolve caller `userId` / `userName` from the bearer token.
  - Insert one `system_logs` row per request: insights refresh, cache read, and date-range fetch.
- `src/components/client/ClientAdAccounts.tsx`
  - Replace `Math.min` with `Math.max` for `lastUpdated`.
  - Force-refresh that query after `refreshAllMutation` finishes.
- `src/components/admin/AdminAdAccounts.tsx` and `src/components/agency/AgencyAdAccounts.tsx` (if same pattern exists) — same `Math.max` fix.
- `src/components/admin/AdminTopUp.tsx`
  - After inserting the `seller_transactions` `client_topup` row, invoke `forward-seller-proof` with the seller + bdt context so the Telegram "Total" line is the correctly-computed Due/Advance.

No DB migrations required.

