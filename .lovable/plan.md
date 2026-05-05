## Goals

1. **Seller Dashboard** (`/dashboard` — seller role): replace the current "Month-by-Month Due / Advance" list card with the admin-style **Month View toggle + month picker** (matches 2nd screenshot).
2. **Excel exports**: split into two separate buttons everywhere — **Monthly Excel** (colorful styled, per-month sheets) and **Excel / Total** (all columns, full ledger). Apply on both seller dashboard and admin seller view.

---

## Changes

### 1. `src/components/seller/SellerDashboard.tsx`

- Remove `<MonthlyDueAdvanceCard />` (line 371) and its import.
- Add state: `monthView: boolean`, `activeBucket: {year, month}`.
- Build `availableMonths` from `transactions` (newest first, like admin).
- Add a toolbar above the summary cards:
  - `Button` "Month View: ON/OFF" (toggles `monthView`).
  - `Select` listing `availableMonths` (uses `monthLabel`).
  - When ON, show small "Opening" + "Current Due/Adv" pills (read-only — no Close Month for sellers).
- Apply month filter to `filtered` when `monthView` is ON (`isSameMonth(getMonthBucket(t.created_at), activeBucket)`).
- Compute `displayDueAdvance`:
  - All-time: existing `dueAdvance` from full ledger.
  - Month view: opening (carry-forward via `computeLedgerBalanceBefore`) + month delta (via `aggregateMonth`).
- Replace single Excel button with two buttons in the header action group:
  - **Excel** → existing `exportToExcel` extended to include ALL columns (Date, Month, Type, Status, Transaction ID, BDT, USDT, Rate, Converted BDT, Bank, Account Name, Change BDT, Due/Advance BDT, Description, Proof URL, Not Calculated Reason).
  - **Monthly Excel** → opens dialog (reuse the column-picker pattern), produces per-month sheets using the colorful styled layout currently in `AdminSellers.exportToExcel` (yellow opening row, red totals, blue header, final balance cell).

### 2. `src/components/admin/AdminSellers.tsx`

- **Excel button** (`exportToExcel`, line 956–1150): keep colorful design, but move that colorful design into `exportMonthlyToExcel` (per-month sheets). Replace the `Excel` button handler with a "all columns, all months in one sheet" exporter (same column set as the dialog's `ALL_EXPORT_COLS`, no column picker — just dump everything).
- **Monthly Excel button** (`exportMonthlyToExcel`, line 870–947): rewrite so each month sheet uses the **colorful styled layout** (header row with blue + yellow Final cell, yellow opening row, red totals, running Due/Adv column) — one sheet per month. Keep the existing dialog (month picker + "all months" checkbox) but drop the column-selection grid (colorful layout has fixed columns). Optionally keep "all months" checkbox.
- Remove the `MonthlyDueAdvanceCard` from seller dashboard only — admin already uses month view toolbar, no change needed there.

### 3. `src/components/seller/MonthlyDueAdvanceCard.tsx`

- File becomes unused after step 1. Leave file in place (no deletion needed) or remove if confirmed safe.

---

## Technical notes

- Reuse helpers from `src/lib/sellerMonthlyClose.ts` (`getMonthBucket`, `monthLabel`, `filterMonth`, `aggregateMonth`, `computeLedgerBalanceBefore`, `computeRunningWithOpening`, `sortSellerTxnsAsc`) — already used by `AdminSellers`.
- Use `xlsx-js-style` (`XLSXStyle`) for the colorful Monthly export — same import already present in `AdminSellers.tsx`.
- Seller does NOT get Close/Reopen/Recalc buttons — Month View is read-only for them.
- Both Excel buttons respect existing filters (type/bank/date) only on the **Total** export; Monthly export iterates raw transactions per bucket regardless of filters (consistent with current admin behavior).

## What the user will see

- **Seller Dashboard** (mobile, matches screenshot 2): toolbar `[ Month View: OFF ] [ May 2026 ▾ ]` directly above the Due hero card. Old "Month-by-Month" stacked card is gone.
- **Header buttons**: `[Excel]` `[Monthly Excel]` `[Submit USDT]`.
- **Excel** → one workbook, every column, full ledger.
- **Monthly Excel** → colorful sheet per month with the design from the user's screenshot (header blue, Final balance yellow cell, totals red, opening yellow row).
