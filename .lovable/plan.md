

## Goal

1. **Failed top-up retry success → show source IP**: After a successful retry, display "via Proxy IP `1.2.3.4`" (or "Direct") in the toast and timeline.
2. **Seller dashboard "Total" column = Due/Advance running balance** (not bank cash inflow). Each row's Total shows the seller's accumulated Due (−) or Advance (+) up to that point.
3. **Telegram payment-proof caption**: include the new running Due/Advance total after that payment so reviewers see "Due: −৳47,00,000" or "Advance: +৳47,00,000" right in Telegram.

---

## Plan

### 1. Show IP on successful retry

**`supabase/functions/retry-failed-topup/index.ts`** — `metaFetch` already falls back proxy → direct, but it doesn't return route info.
- Refactor `metaFetch` to return `{ response, via: "proxy"|"direct", sourceIp: string|null }`.
- After the successful Meta POST + verify, capture `via` and `sourceIp` (from proxy header `x-egress-ip`).
- Write into `failed_topups` row BEFORE deleting it (or change to `status='resolved'` so history stays — but current code deletes; we'll keep the delete and instead include the info in the response payload + system_logs).
- Update `system_logs.details` to append " — via Proxy (IP: 1.2.3.4)" or " — via Direct".
- Return `{ success, new_spend_cap, via, source_ip }` in JSON response.

Apply the same `metaFetch` upgrade to `spend-cap-update`, `resolve-failed-topup`, `tiktok-topup`, `get-account-insights` for consistency.

**`src/components/FailedTopUps.tsx`** — `retryMutation.onSuccess`:
- Show enhanced toast: `Spend cap updated to $X — via Proxy (IP: 1.2.3.4)` or `via Direct`.

### 2. Seller dashboard Total column = Due/Advance running balance

Rewrite **`src/lib/sellerRunningTotal.ts`** logic:

Instead of "per-bank cash balance", compute a single global running **Due/Advance** number per row (chronological):

```text
running += bdt_amount    when type = bdt_payment OR client_topup   (money received → reduces due / increases advance)
running -= bdt_amount    when type = withdraw                       (cash out → increases due)
running -= usdt_amount * rate   when type = usdt_received           (USDT given to client = cost → increases due)
```

Result: positive = Advance (seller received more than owed), negative = Due (seller owes/needs to pay).

- New function `computeDueAdvanceRunning(transactions): Map<txn_id, number>` (single global series, no per-bank split).
- Keep `formatBdt` but add `formatDueAdvance(value)` returning `+৳47,00,000` (green) or `−৳47,00,000` (red).

**`src/components/seller/SellerDashboard.tsx`**:
- Replace `runningTotals.get(t.id)` usage in the Total column (mobile + desktop + Excel export).
- Total column header → "Due/Advance".
- Cell: red text + "−" prefix when negative (Due), green + "+" prefix when positive (Advance).

### 3. Telegram caption — include Due/Advance after payment

**Remote edge function `forward-seller-proof`** (deployed on Supabase, not in repo). Update it to:
- Before sending the Telegram message, query `seller_transactions` for this `seller_id` ordered ASC, run the same Due/Advance reduction up to and including the just-inserted row.
- Append a new line to the caption:
  ```
  📊 Total: Due ৳47,00,000  (or Advance +৳47,00,000)
  ```
- Color cue with emoji: 🔴 for Due, 🟢 for Advance.

**Caller side** (`src/components/admin/AdminSellers.tsx` and any other place that invokes `forward-seller-proof`):
- Pass `seller_id` in the body so the function can compute the running total. Currently it isn't passed — verify and add.

```text
Telegram caption (new format):
─────────────────────────────
💰 New BDT Payment
Seller: Faisal Kabir
Amount: ৳1,00,000
Bank: City Bank ****1234
TrxID: ABC123
🔴 Total: Due ৳47,00,000
─────────────────────────────
```

---

## Technical Details

- `metaFetch` change is backward-compatible (existing callers ignore the new fields).
- Due/Advance computation uses ALL approved transactions (pending/rejected skipped), sorted by `created_at` ASC, regardless of bank — it's a single global running balance per seller.
- Telegram function will read transactions via service-role client (already used) — no RLS issue.
- Excel export "Running Total" column renamed to "Due/Advance (BDT)" with signed values.

---

## Files Touched

- `supabase/functions/retry-failed-topup/index.ts` — `metaFetch` returns `{response, via, sourceIp}`, response/log includes IP.
- `supabase/functions/spend-cap-update/index.ts`, `resolve-failed-topup/index.ts`, `tiktok-topup/index.ts`, `get-account-insights/index.ts` — same `metaFetch` upgrade (already partially done, verify).
- `supabase/functions/forward-seller-proof/index.ts` — append Due/Advance line; recreate locally (currently only on remote).
- `src/lib/sellerRunningTotal.ts` — new `computeDueAdvanceRunning` + `formatDueAdvance`.
- `src/components/seller/SellerDashboard.tsx` — use new running total, color-code, rename column.
- `src/components/FailedTopUps.tsx` — toast shows IP/route on success.
- `src/components/admin/AdminSellers.tsx` — pass `seller_id` to `forward-seller-proof`.

---

## Out of Scope

- Showing IP for failed (still-pending) attempts — only success path for now.
- Direct-call IP (Cloudflare Worker outbound IP isn't exposed) — will display "Direct" without IP.
- Changing per-bank chip totals on the dashboard (those stay as cash-in per bank).

