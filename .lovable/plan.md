## Seller Month-to-Month Closing System

### Problem (Bangla)

Ekhon `seller_transactions` er upor sob calculation suru theke (all-time) cumulative ভাবে hoy. Mas-er por mas data joma hocche → kono ek jaygay missing/bhul hole **puro history** abar milate hoy. Tumi chao:

- Proti maser sheshe oy maser BDT/USDT lendend close hobe
- Closing Due/Advance (signed BDT balance) porer maser **opening balance** hisebe carry forward hobe
- Notun maser calculation ey opening + oy maser transactions = closing → erpor abar carry
- Excel **month-by-month** download
- Kono problem hole sudhu **running month** er data theke fix korlei cholbe (ager closed month untouched)
- exel download korar somoy kon kon row lagbe seta select korte chaile seta slect kore download korte parbe.karon sobar sob row lagbe na .hoyto sudhu date,bdt ,usdt ,rate,total due /adv lagte pare

### Solution Overview

Ekta notun table `seller_monthly_closings` rakhbo. Proti seller × proti month er ekta row:

- `opening_due_advance_bdt` — oy maser shuru-r balance (= ager maser closing)
- `month_bdt_in`, `month_client_bdt`, `month_usdt_given`, `month_converted_bdt`, `month_withdraw_bdt`
- `closing_due_advance_bdt` — opening + (month delta)
- `closed_at`, `closed_by`, `is_locked`

Ekta button **"Close This Month"** thakbe AdminSellers ey — admin click korle:

1. Oy seller-er shob approved transactions oy month-er (UTC+6) niye monthly aggregate calculate hobe
2. Ager month-er `closing_due_advance_bdt` opening hisebe nibe (na thakle 0)
3. Notun row insert / update hobe, `is_locked = true`
4. Locked month er transactions ar edit/delete kora jabe na (frontend guard + RLS)

### UI Changes — `AdminSellers.tsx`

**1. New "Month View" toolbar:**

- Month picker (default: current month)
- "Opening Balance" pill: `+৳12,500 Advance` (ager month closing theke)
- "This Month Net" pill: signed delta
- "Closing Balance" pill: live calculation
- "Close Month" button (only on past/current month, requires confirmation)
- "Reopen Month" button (superadmin only) — unlocks for fixes

**2. Running balance correction:**
`computeDueAdvanceRunning` ekhon ekta `openingBalance` parameter nibe. Per-month view ey shob row oy maser opening theke suru hobe (na hole all-time)

**3. Monthly Excel export:**
Notun button **"Download Monthly"** — drop-down: Jan 2026, Dec 2025, Nov 2025… Each export ey:

- Header: Seller name, Month, Opening Balance
- Transaction rows (ager moto column) with running balance starting from opening
- Footer: Month totals + Closing Balance
- Filename: `{seller}-{YYYY-MM}-ledger.xlsx`

**Existing "Export All" button thakbe** — full history (current behavior preserved)

**4. Visual lock indicator:**
Locked month er row gulo subtle gray background + lock icon, edit/delete button disabled

### Database Schema

```sql
create table public.seller_monthly_closings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references profiles(user_id) on delete cascade,
  year int not null,
  month int not null,  -- 1-12
  opening_due_advance_bdt numeric not null default 0,
  month_bdt_in numeric not null default 0,
  month_client_bdt numeric not null default 0,
  month_usdt_given numeric not null default 0,
  month_converted_bdt numeric not null default 0,
  month_withdraw_bdt numeric not null default 0,
  closing_due_advance_bdt numeric not null default 0,
  is_locked boolean not null default true,
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  note text,
  unique (seller_id, year, month)
);
```

RLS: only admin/superadmin select/insert/update; superadmin can delete (reopen).

Optional safeguard trigger on `seller_transactions`: block insert/update/delete if `created_at` falls in a locked month — admin/superadmin override flag. (Recommend: warn-only in v1, add hard lock in v2 once you trust the workflow.)

### Carry-Forward Logic

```
opening = previous_month.closing_due_advance_bdt  (or 0 if first month)

month_delta =
   sum(bdt_payment + client_topup + tenant_payment)  // +
 - sum(usdt_amount * rate for usdt_received)         // -
 - sum(withdraw bdt_amount)                          // -

closing = opening + month_delta
```

Identical to existing `computeDueAdvanceRunning` formula — just bucketed per month.

### Files

**New:**

- `src/lib/sellerMonthlyClose.ts` — `getMonthBucket(date)`, `aggregateMonth(txns)`, `computeRunningWithOpening(txns, opening)`, `closeMonth(sellerId, year, month)`, `getOpeningFor(sellerId, year, month)`
- Migration: `seller_monthly_closings` table + RLS

**Modified:**

- `src/lib/sellerRunningTotal.ts` — add optional `openingBalance` param to `computeDueAdvanceRunning`
- `src/components/admin/AdminSellers.tsx` — month picker, opening/closing pills, Close Month button, monthly Excel export, lock indicators

### Out of Scope (v1)

- Auto-close cron (admin click for now — predictable)
- Hard DB-level lock on locked-month edits (warn only first)
- Client-facing seller view changes

### Approval Needed

Approve korle ami migration + code change kore dibo. Default behavior (all-time view) thakbe — month closing optional layer, jokhon use korbe tokhon kaj korbe.