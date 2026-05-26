
## 1. Withdraw display — BDT only (UI fix)

Screenshot er card ta admin er "Seller Detail" page theke (`AdminSellers.tsx`). Withdraw type bortomane "else" branch e jay, tai USDT / Rate / Conv. BDT (sob 0) dekhay. Same bug seller's own ledger eo thakte pare.

**File: `src/components/admin/AdminSellers.tsx`**
- Mobile card (line ~1752): condition theke `t.type === "bdt_payment" || t.type === "client_topup"` → `t.type === "bdt_payment" || t.type === "client_topup" || t.type === "withdraw"`. Label hobe "Withdraw (BDT)", color rose, value `−৳{bdt_amount}`.
- Desktop table (line ~1930–1933): withdraw row e USDT / Rate / Conv.BDT cell e "—" dekhabo (shudhu BDT column populated).

**File: `src/components/seller/SellerDashboard.tsx`**
- Mobile card eo same logic verify — currently non-`usdt_received` already BDT-only, but `withdraw` er label/sign clearer korbo ("Withdraw" + `−৳`).
- Desktop table (line ~840–851): withdraw row e USDT / Rate / Conv.BDT "—" rakhbo.

Running balance / Due-Advance logic kichui change hobe na (already `computeTransactionDelta` only uses `bdt_amount` for withdraw).

## 2. Seller-initiated Withdraw Request

Notun flow: seller nije amount + note diye request korbe → pending row → admin approve korle main balance theke minus.

### Database
Existing `seller_transactions` table use korbo (already has `status`, `admin_note`, `reviewed_by`, `reviewed_at`). Withdraw request = ekta row with:
- `type = 'withdraw'`
- `bdt_amount = requested amount`
- `description = seller's note`
- `status = 'pending'`
- `seller_id = current seller user id`
- `entry_by_name = 'self-request'`

Pending row already running-balance e count hocche na (`isCountedSellerTransaction` checks `status === 'approved'`).

**RLS update needed** — ensure sellers can INSERT their own pending withdraw rows into `seller_transactions` (only when `seller_id = auth.uid()` AND `type = 'withdraw'` AND `status = 'pending'`). UPDATE/approve shudhu admin.

### Frontend — Seller side

**New component: `src/components/seller/SellerWithdrawRequest.tsx`**
- "Request Withdraw" button → Dialog
- Inputs: Amount (BDT, required, > 0), Note (optional textarea)
- Submit → insert seller_transactions row (status='pending'), then create admin notification (same pattern as `AgencyWallet.handleRequestBalance`).
- Toast confirmation, invalidate `seller-transactions` query.

**Mount in `SellerDashboard.tsx`** — top action bar e button add korbo (near filter toggle / running balance summary).

### Frontend — Admin side

**In `AdminSellers.tsx`** seller detail view:
- Pending withdraw rows er pashe "Approve" + "Reject" button (mobile card + desktop table).
- Approve → `UPDATE seller_transactions SET status='approved', reviewed_by=auth.uid(), reviewed_at=now()`. Existing trigger (`trigger_forward_seller_txn`, `trigger_sheet_sync_on_seller_txn`) already handles forward + sheet sync on approval — no extra work.
- Reject → `status='rejected'` + optional admin_note.
- Pending rows visually distinct (amber badge already exists via StatusBadge).

### Notifications
Use existing `notifications` table — on submit insert notification per admin/superadmin (same as AgencyWallet pattern); on approve/reject insert notification for the seller.

## 3. Access
- Route already exists (`/seller-topups` etc.); Withdraw request button bosbe Seller Dashboard er top e — sob seller (role = seller / superadmin) er jonno available.
- Locked-functions checklist: this touches `seller_transactions` writes but **does NOT modify** the OCR/auto-approval/forwarding logic — only adds a new pending insert path + manual approve path. Forward/sheet-sync triggers already fire on `status` transition to approved, so behavior consistent.

## Technical summary
- 2 file edits (display): `AdminSellers.tsx`, `SellerDashboard.tsx`
- 1 new component: `SellerWithdrawRequest.tsx`
- 1 migration: RLS policy for seller insert + admin update on `seller_transactions` (verify current policies first; may already allow).
- Admin approve/reject UI snippet in `AdminSellers.tsx`.
- No edge function or schema column changes needed.
