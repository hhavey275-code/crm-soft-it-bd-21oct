## Goal

Top Up page-এর "Forward Missing" dialog (currently 7 entries) এখন শুধু Date / Client / USD Amount / Result দেখায়। User চাচ্ছে প্রতিটা row-এ দেখা যাক — কোন bank-এ এসেছে, BDT কত, কোন Telegram group-এ forward হবে, এবং seller sheet-এ already আছে কিনা (অর্থাৎ forward + ledger create হবে নাকি শুধু forward)।

## Changes — `src/components/admin/AdminTopUp.tsx`

### 1. `missingForwards` enrich (around line 268)

`useMemo`-তে candidates filter করার পর extra query দিয়ে enrich করব:

- Collect `req.id` array → query `seller_transactions` `select("top_up_request_id").in("top_up_request_id", ids)` → `mirrorSet`.
- Already `r.bankAccount` আছে (bank_name, telegram_group_id) — সেটাই ব্যবহার করব।
- প্রতিটা row-এ যোগ হবে: `bank_name`, `telegram_group_id`, `bdt_amount` (already on row), `mirror_present` (boolean)।

যেহেতু `useMemo` async হতে পারে না, সরিয়ে আলাদা `useQuery(["missing-forward-mirrors", ids])` করব যা শুধু mirror set return করে। তারপর derived `missingForwards` array সেটার সাথে merge করবে।

### 2. Dialog table columns (line ~1150-1178)

নতুন columns:

```
Date | Client | Bank | USD | BDT | Telegram | In Sheet | Action | Result
```

- **Bank**: `r.bankAccount?.bank_name || "—"`
- **USD**: `$<amount>`
- **BDT**: `৳<bdt_amount>`
- **Telegram**: group id badge (truncated, tooltip full id)
- **In Sheet**: ✅ if mirror_present, ❌ "Will create" if not
- **Action**: small text — "Forward only" (mirror_present=true) বা "Forward + Add to sheet" (mirror_present=false)
- **Result**: same as before

### 3. Dialog description copy update

Replace static line দিয়ে summary count: "X-টি forward হবে · Y-টি seller sheet-এও যোগ হবে।"

### 4. Mobile responsive

Dialog already `max-w-2xl` — table will be wide. Wrap in existing `overflow-y-auto` div, also add `overflow-x-auto`. Keep font-size `text-xs` for new cells.

## Out of scope

- Forwarding logic itself unchanged (`forward-proof` edge function already creates seller mirror when missing).
- No DB migration needed — RLS already allows admin to read `seller_transactions` and `bank_accounts`.
