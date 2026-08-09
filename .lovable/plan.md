# Dual Wallet (Regular + Sheet Rate) System

হ্যাঁ, বুঝেছি। যেসব client-এর data এখন sheet থেকে আসে (Holy Gift, Cafe La ইত্যাদি) তাদের জন্য দুইটা আলাদা wallet — একটা regular dollar rate (যেমন ১২৯৳), আরেকটা sheet rate (যেমন ১২৪৳)। দুইটার balance আলাদা, উপরে একটা combined total, top-up limit update-এর সময় কোন wallet থেকে যাবে সেটা বাছা যাবে, transaction history-তে দুই ধরনের entry আলাদা রঙে দেখাবে, আর feature শুধু যাদের জন্য ON করা হবে তাদের জন্যই চালু থাকবে।

## Client যা দেখবে

- **Wallet page**: উপরে "Total Balance" কার্ড (primary + secondary), নিচে দুইটা কার্ড — "Main Wallet · ৳129/$" এবং "Sheet Wallet · ৳124/$"। Feature OFF থাকলে আগের মতোই একটাই কার্ড, কোনো পরিবর্তন নেই।
- **Top-up request**: কোন wallet-এ টাকা যোগ হবে সেটা বাছার toggle (Main / Sheet), rate সেই wallet-এর rate অনুযায়ী auto বসবে (BDT ↔ USD হিসাব)।
- **Spend cap / limit update**: dialog-এ source selector — Main wallet, Sheet wallet, অথবা "Auto (Main আগে, বাকিটা Sheet)"। প্রতিটা wallet-এর available balance পাশে দেখাবে।
- **Transaction history**: প্রতিটা row-এ wallet badge — Main = primary/blue, Sheet = teal/amber; আর একটা filter (All / Main / Sheet)। Limit update entry-তে "spend cap $X → $Y" আগের মতোই থাকবে, শুধু কোন wallet থেকে হয়েছে সেটা রঙ + badge দিয়ে আলাদা হবে।

## Admin যা দেখবে

- Client detail page-এ toggle: **"Secondary (sheet) wallet enabled"** + secondary rate ইনপুট।
- দুই wallet-এর balance আলাদা, manual credit/debit করার সময় কোন wallet সেটা বাছা যাবে।
- Top-up approve করার সময় কোন wallet-এ credit হবে দেখা + বদলানো যাবে।

## Deduction rule

- Explicit ভাবে wallet বাছা হলে শুধু সেই wallet থেকেই কাটবে (balance না থাকলে error)।
- "Auto" হলে আগে primary, বাকিটা secondary — একটাই atomic operation, দুইটা আলাদা ledger row (একটা primary, একটা secondary) একই reference id দিয়ে।
- Refund হলে ঠিক যে wallet থেকে কাটা হয়েছিল সেখানেই ফেরত যাবে।

## Technical plan

**Database (migration)**
- `profiles`: `secondary_wallet_enabled boolean default false`, `secondary_usd_rate numeric` (null হলে primary rate)।
- নতুন টেবিল `secondary_wallets` (user_id unique, balance, currency, timestamps) — grants + RLS: client নিজের row পড়বে, admin/superadmin সব, service_role all।
- `transactions`: `wallet_kind text not null default 'primary'` (`'primary' | 'secondary'`, validation trigger), `usd_rate_used numeric` (audit-এর জন্য কোন rate-এ হয়েছে)।
- `top_up_requests`: `wallet_kind text default 'primary'` — কোন wallet-এ credit হবে।
- নতুন RPC `deduct_wallet_for_topup_v2(p_user_id, p_amount, p_ad_account_id, p_description, p_processed_by, p_source text /* primary|secondary|auto */, p_allow_negative, p_due_limit)`:
  - দুই wallet row lock করে, প্রতিটাকে নিজের ledger (`wallet_kind` অনুযায়ী sum) দিয়ে reconcile করে, তারপর কাটে — existing atomic/phantom-balance protection দুই wallet-এর জন্যই থাকবে।
  - Return: প্রতি wallet-এর before/after + কোন কোন txn তৈরি হলো।
  - পুরোনো `deduct_wallet_for_topup` অপরিবর্তিত থাকবে (backward compatible), v2 শুধু primary মানে identical behaviour।

**Edge function `spend-cap-update`**
- Request body-তে নতুন optional `wallet_source` ('primary' | 'secondary' | 'auto', default 'primary')।
- Deduction v2 RPC দিয়ে; refund path-ও wallet_kind অনুযায়ী সঠিক wallet-এ ফেরত দেবে।
- `failed_topups` ও system log-এ wallet_kind রাখা হবে যাতে retry ঠিক wallet ব্যবহার করে।

**Top-up approve path (`verify-topup` / admin approve)**
- Request-এর `wallet_kind` অনুযায়ী সঠিক wallet-এ credit + সঠিক rate দিয়ে BDT→USD হিসাব।

**Frontend**
- নতুন hook `useWallets(userId)` — primary + secondary + total + enabled flag + rates এক জায়গায়।
- `ClientWallet.tsx`: total + দুই wallet কার্ড (feature OFF হলে অপরিবর্তিত)।
- `ClientTopUp.tsx`: wallet selector + rate সেই অনুযায়ী।
- Spend cap dialog(গুলো) (`ClientAdAccounts`, `AdAccountDetailPage`, admin top-up path): wallet source selector।
- `ClientTransactions.tsx` + `ClientDetailPage` ledger: wallet badge, রঙ আলাদা (semantic token দিয়ে, hardcoded color নয়), filter।
- `ClientDetailPage` admin section: enable toggle + secondary rate + secondary manual credit/debit।

**Safety**
- Feature OFF (`secondary_wallet_enabled = false`) হলে সব code path আজকের মতোই আচরণ করবে — কোনো existing client প্রভাবিত হবে না।
- Existing সব transaction automatically `wallet_kind = 'primary'` হয়ে যাবে, তাই পুরোনো history অটুট থাকবে।

## Build order

1. Migration (columns, secondary_wallets, RPC v2)।
2. Edge function `spend-cap-update` + top-up approve path।
3. Admin toggle + rate UI।
4. Client wallet/top-up/limit-update/transaction UI।
5. একটা test client-এ ON করে end-to-end যাচাই।
