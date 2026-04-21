

## Goal

User-er feedback অনুযায়ী 3-ta jinis confirm/finish korte hobe:

1. **Seller dashboard-er per-row "TOTAL"** — running Due/Advance dekhabe (e.g. last BDT Payment row e `Due −৳48,09,340.66`), per-bank cash-in noy.
2. **Telegram payment-proof caption** — payment forward howar somoy niche oi exact running total line jabe (`🔴 Total: Due −৳48,09,340`).
3. **Notun: Chronological "Balance History" chart** — kivabe Due/Advance build up holo seta visual timeline e dekhabe (payment add → due kome, USDT given → due barhe, etc.).

---

## Current State (verified via DB + code read)

- DB-e Faisal Kabir-er **actual Due = −৳48,09,340.66** (BDT in 82,41,665 − USDT cost 1,30,51,005.66). Apnar mention kora "48 lakh due" eta exactly match.
- `src/components/seller/SellerDashboard.tsx` ar `src/components/admin/AdminSellers.tsx` — code-e already `formatDueAdvance(runningTotals.get(t.id))` wired ache prottek row e (mobile + desktop). Apnar screenshot-e "TOTAL ৳42,56,500" (green positive) jeta dekhachhe seta **purono cached build** — refresh/rebuild lagbe, code already correct.
- `supabase/functions/forward-seller-proof/index.ts` — local code-e Due/Advance line caption-e add kora hoye gechhe, kintu **edge function ekhono deploy hoyni** Supabase-e — tai Telegram-e ekhono purono caption jachhe.

---

## Plan

### 1. Deploy `forward-seller-proof` edge function

Supabase-e local file-er notun version push korte hobe jate Telegram caption-e Due/Advance line jay:

```
💰 Seller Payment
👤 Faisal Kabir
🏦 City bank — 1454533103001
৳800,000
🔖 Ref: 261121728464
🔴 Total: Due −৳48,09,340
```

Verify after deploy: 1-ta test BDT payment kore Telegram check.

### 2. Force fresh build for SellerDashboard / AdminSellers

Code already correct — kintu apnar screenshot-er per-row "TOTAL ৳42,56,500" purono. Browser hard-refresh / cache-bust korte hobe। Ami extra koren sure korte ekta tiny version-marker comment add korbo jate Vite forced rebuild kore.

Ar **per-row label ektu boro/clear korbo** mobile card-e — ekhon "📊 Due" small text e ache, eta boro "TOTAL: Due −৳48,09,340" font-e dekhabo jate apnar screenshot-er TOTAL row-er position-eyi seta dekhay (eta confirm korbe je "TOTAL" label-er pasher value Due/Advance, bank cash-in noy).

### 3. New: "Balance History" visual chart on selected seller

`AdminSellers.tsx` selected seller view-er upore ekta notun **collapsible chart card** add korbo:

- **Line chart** (recharts use kore — already installed): X-axis = chronological dates, Y-axis = running Due/Advance balance.
- Color: line green jokhon Advance (above 0), red jokhon Due (below 0).
- Hover-tooltip: oi point-er date + transaction type + amount + balance.
- Below the chart, ekta compact **timeline list** (Last 10 movements):
  ```
  Apr 22  +৳800,000 BDT Payment       → Due −৳48,09,340
  Apr 21  +৳38,400  Client Top-Up     → Due −৳48,89,340
  Apr 17  −৳41,19,444 USDT Given (32694 × 126) → Due −৳49,27,740
  ...
  ```
  Prottekta entry-te show kora hobe: date, +/- amount + type, → resulting balance (color-coded).

Eta exactly user-er chaowa "kivabe due build holo, one by one, kisher pore ki update hochhe" seta visualize korbe.

Same chart **SellerDashboard.tsx** (seller's own view) e ও add korbo.

### 4. Quick sanity guards

- `computeDueAdvanceRunning` already chronological ASC sort e chole — confirm. ✅
- Per-row balance ALL transactions theke compute hoy (filtered noy) — confirm. ✅ (fixed previous turn)
- Telegram forward-er somoy `seller_id` pass hochhe — verify caller in `AdminSellers.tsx` saveOcrMutation (line 219 `seller_id: selectedSeller.user_id` already passed). ✅

---

## Technical Details

- **Chart library**: `recharts` (already in deps via shadcn `chart.tsx`). Use `LineChart` with `ReferenceLine y={0}`.
- **Data prep**: From `sellerTxns` ASC-sorted, build `[{date, balance, type, delta}]` array. Same logic as `computeDueAdvanceRunning` but emit each step.
- **Mobile card emphasis**: Replace small "📊 Due" with bordered footer row showing "TOTAL" label + colored amount, identical visual weight to the existing summary so user clearly sees this is the running balance, not bank-cash.
- **Edge deploy**: `forward-seller-proof` push to Supabase via deploy tool.

---

## Files Touched

- `supabase/functions/forward-seller-proof/index.ts` — redeploy (no source change, local already correct).
- `src/components/seller/SellerDashboard.tsx` — bigger TOTAL footer per row + new BalanceHistoryChart component above ledger.
- `src/components/admin/AdminSellers.tsx` — bigger TOTAL footer per mobile card + same BalanceHistoryChart for selected seller.
- `src/components/seller/BalanceHistoryChart.tsx` — NEW: line chart + timeline list of running balance progression.

---

## Out of Scope

- Changing "BDT Received / USDT Given / USDT(BDT) / Withdrawn" summary cards — those stay as filter chips; chart is the "how it built up" view.
- Per-bank chip totals (City Bank ৳42,56,500 etc.) stay as bank cash-in.
- Failed top-up retry IP display — already implemented previous turn, will verify by triggering a retry.

