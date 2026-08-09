# Dual Wallet (Main + Secondary Sheet-Rate Wallet)

লক্ষ্য: Holy Gift, Cafe La-এর মতো client-দের হিসাব আর sheet-এ রাখতে হবে না — পুরো হিসাব CRM-এই থাকবে। প্রতি enabled client-এর দুইটা wallet: **Main wallet** (regular rate, যেমন ৳129/$) আর **Secondary wallet** (sheet rate, যেমন ৳124/$)। উপরে একটা **combined card** যেখানে দুই wallet মিলিয়ে total due / advance দেখাবে।

## মূল নিয়ম

- Limit update (spend cap top-up)-এর সময় **দুইটা আলাদা button**: নীল = Main wallet থেকে, অন্য রঙ (teal/amber) = Secondary wallet থেকে। কোনো auto-split নেই — যে button, সেই wallet থেকেই ডলার minus হবে।
- প্রতিটা wallet-এর নিজের USD rate; সেই rate দিয়েই ওই wallet-এর BDT due/advance হিসাব হবে, আর combined card-এ দুইটার BDT যোগ হয়ে total due/advance দেখাবে।
- **Secondary wallet-এ balance/limit শুধু admin দিতে পারবে** — client secondary wallet-এ top-up request করতে পারবে না। Client শুধু Main wallet-এ আগের মতোই top-up request করবে।
- Feature শুধু যাদের জন্য admin ON করবে তাদের জন্যই চলবে; বাকি সবার কাছে আজকের UI/behaviour হুবহু অপরিবর্তিত।
- Transaction history-তে প্রতিটা entry-তে wallet badge + আলাদা রঙ, আর All / Main / Secondary filter — কোন limit update কোন wallet থেকে হয়েছে (spend cap $X → $Y সহ) স্পষ্ট দেখা যাবে।
- SECONDAT WALLET ER RATE JENO CHANGE KORA JAY , MAIN WALLET ER MOTO 

## Client যা দেখবে (feature ON হলে)

- **Combined card** (উপরে): Total Due / Total Advance — BDT ONLY 
- নিচে দুইটা কার্ড: `Main Wallet · ৳129/$` এবং `Secondary Wallet · ৳124/$` — প্রতিটার balance আলাদা। SECONDAY WALLET E BDT SOHO .DOLLAR AND BDT
- **Limit update dialog**: দুইটা button — "Top up from Main" (blue) এবং "Top up from Secondary" (teal)। প্রতিটার পাশে ওই wallet-এর available balance; balance না থাকলে সেই button disabled।
- **Transactions**: wallet badge/রঙ + filter।
- Top-up (deposit) form-এ কোনো পরিবর্তন নেই — সেটা সবসময় Main wallet।

## Admin যা দেখবে

- Client detail page-এ: **Secondary wallet enabled** toggle + **Secondary USD rate** ইনপুট।
- Secondary wallet-এ manual credit / debit (limit দেওয়া) — reason সহ, ledger-এ log হবে।
- Admin যখন client-এর হয়ে limit update করবে, একইভাবে দুইটা button পাবে।
- Client list / detail-এ combined total due/advance দেখাবে, তাই sheet খোলার দরকার থাকবে না।

## Technical plan

**Database (migration)**

- `profiles`: `secondary_wallet_enabled boolean not null default false`, `secondary_usd_rate numeric`।
- নতুন টেবিল `secondary_wallets` (user_id unique, balance numeric default 0, currency, created_at, updated_at) + GRANTs + RLS (client নিজের row read; admin/superadmin সব; service_role all) + updated_at trigger।
- `transactions`: `wallet_kind text not null default 'primary'` (`primary` | `secondary`, validation trigger), `usd_rate_used numeric`। পুরোনো সব row automatically `primary`, তাই history অটুট।
- নতুন RPC `deduct_wallet_for_topup_v2(p_user_id, p_amount, p_ad_account_id, p_description, p_processed_by, p_wallet_kind, p_allow_negative, p_due_limit)`:
  - নির্দিষ্ট wallet row lock → সেই wallet-এর ledger (`wallet_kind` অনুযায়ী sum) দিয়ে reconcile → deduct → ledger row insert।
  - Balance না থাকলে `insufficient_balance` return (secondary-তে due_limit প্রযোজ্য নয়)।
  - বর্তমান atomic/phantom-balance protection দুই wallet-এই থাকবে; পুরোনো `deduct_wallet_for_topup` অপরিবর্তিত থাকবে।
- নতুন RPC `admin_adjust_secondary_wallet(p_user_id, p_amount, p_reason, p_admin)` — admin-only credit/debit + ledger + system log।

**Edge function `spend-cap-update**`

- Body-তে নতুন optional `wallet_kind` ('primary' default | 'secondary')।
- Deduction ও refund path v2 RPC দিয়ে, সবসময় ঠিক সেই wallet-এ ফেরত।
- `failed_topups` + system log-এ `wallet_kind` রাখা হবে, যাতে retry ভুল wallet ব্যবহার না করে।

**Frontend**

- নতুন hook `useWallets(userId)`: main balance, secondary balance, দুই rate, enabled flag, এবং combined BDT total (main×rate1 + secondary×rate2)।
- `ClientWallet.tsx`: combined card + দুই wallet কার্ড (OFF হলে অপরিবর্তিত)।
- Limit-update dialog গুলো (`ClientAdAccounts`, `AdAccountDetailPage`, admin top-up path): দুইটা button, semantic color token দিয়ে (hardcoded color নয়)।
- `ClientTransactions.tsx` + `ClientDetailPage` ledger: wallet badge, রঙ, filter।
- `ClientDetailPage` admin panel: toggle + secondary rate + secondary credit/debit dialog।

## Build order

1. Migration (columns, `secondary_wallets`, RPC v2, admin adjust RPC)।
2. `spend-cap-update` edge function-এ `wallet_kind` support + refund correctness।
3. Admin UI: toggle, rate, secondary balance দেওয়া।
4. Client UI: combined card, দুই wallet কার্ড, দুইটা top-up button, transaction badge/filter।
5. একটা client (যেমন Holy Gift)-এ ON করে end-to-end যাচাই — দুই wallet থেকে limit update, refund, combined due মিলিয়ে দেখা।