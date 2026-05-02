## Implementation Plan

User approved. Final numbers confirmed: **+৳1,46,117.25 Adv** after migration (154 archive + 3 existing live rows).

### Step 1 — Migration via admin button (no schema change)

`code--exec` e psql nei, schema migration tool nei. Tai ami `OldSellerBreakdown` e ekta **"Migrate Forwarded → Live Ledger"** button add korbo (admin-only, RLS satisfied — admin er sob seller_transactions e access ase). Button click korle:

- Archive er Forwarded sheet er 154 rows fetch
- `bdt_payment` / `tenant_payment` → type rewritten to `client_topup` (manual badge dekhabe na)
- `withdraw` as-is
- Original `id` retain — re-clicking idempotent (PK conflict skip)
- `telegram_forwarded = true` for all client_topup rows
- Confirmation dialog before insert
- Toast result after

Duplicate insert protection: 409/duplicate errors per row caught and counted as "already migrated".

### Step 2 — Monthly Summary card in `SellerDashboard`

Notun file: `src/components/seller/MonthlyDueAdvanceCard.tsx` — month-by-month aggregation:
- Group transactions by `YYYY-MM` (UTC)
- Per month: Payments IN, Withdraw, USDT cost, Net Δ, Running cumsum
- Existing `formatDueAdvance()` helper for Adv/Due colors
- Table on `md+`, stacked cards on mobile

Mount in `SellerDashboard.tsx` between summary cards and the bank chips.

### Step 3 — Banner in `OldSellerBreakdown`

Migration sefe-i hoyese kina detect kore (live ledger query) ar banner show kore: "✅ Forwarded sheet er XXX entry live ledger e migrate hoyese."

### Files Touched

- New: `src/components/seller/MonthlyDueAdvanceCard.tsx`
- Edit: `src/components/seller/SellerDashboard.tsx` (mount card)
- Edit: `src/components/admin/OldSellerBreakdown.tsx` (migrate button + status banner)

### Non-goals

- Not-Forwarded data NOT migrated.
- Other sellers untouched (button hard-checks Rasel's seller_id only as a safety guard, with override toggle for future use).
- No DB schema changes.
