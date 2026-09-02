# Referral / Affiliate System

Existing client-রা নতুন client refer করলে তাদের একটা referral link থাকবে, সেই link দিয়ে
signup হওয়া client-এর Meta ad spend-এর উপর প্রতি ডলারে একটা commission (যেমন $0.10)
referrer পাবে — শুধু সেই মাসেই, যেই মাসে referred client কমপক্ষে $3,000 spend করে।
Commission admin approve করলে referrer-এর main wallet-এ USD credit হবে।

## যা তৈরি হবে

### 1. Referral link
- প্রতিটি client-এর profile-এ একটা unique referral code (যেমন `SB7K2M`) তৈরি হবে।
- Link: `https://<site>/signup?ref=SB7K2M`
- Signup form (email + Google — দুটোতেই) ref code ধরে রাখবে এবং নতুন account-এর সাথে
  referrer-কে permanently bind করবে। Google OAuth-এ redirect হয়ে যায়, তাই code
  browser-এ সংরক্ষণ করে ফেরার পরে attach করা হবে।
- একবার bind হলে referrer আর বদলানো যাবে না (self-referral ও blocked)।

### 2. Client-এর Referral page (client dashboard-এ নতুন menu "Referral")
- নিজের link + copy button + share
- আমার rate (যেমন $0.10 per $1 spend), minimum $3,000/month rule লেখা
- Referred client-দের তালিকা: নাম, join date, চলতি মাসের spend, threshold পার হয়েছে কি না
- Month-wise earning table: মাস | referred client spend | eligible spend | commission | status
  (Pending / Requested / Approved / Paid)
- Total earned / paid / available balance + "Withdraw to wallet" request button
- CSV download (office report-এর জন্য)

### 3. Admin panel (Referrals page)
- সব referrer, তাদের referred client সংখ্যা, মোট spend, মোট commission
- Global default rate সেট করা (Settings) + প্রতিটি referrer-এর জন্য আলাদা negotiated rate
  (override) বসানো/বদলানো
- প্রতি মাসের commission হিসাব দেখা, একটা mismatch হলে recalculate button
- Referrer-এর withdraw request Approve / Reject — approve করলে তার main wallet-এ
  USD credit হবে (existing atomic wallet RPC দিয়ে, তাই wallet integrity ঠিক থাকবে)
- নতুন referral signup ও withdraw request হলে admin notification + sidebar badge

### 4. হিসাব কীভাবে হবে
- Spend source: CRM-এ প্রতিদিন যে per-client Meta spend সংরক্ষণ হয় (`client_daily_stats`)
  সেটাই ব্যবহার হবে — মাস ধরে যোগ করা হবে।
- প্রতি মাস, প্রতি referred client: মাসিক spend ≥ $3,000 হলে
  `commission = monthly_spend × rate`; $3,000-এর নিচে হলে commission = 0।
- হিসাব প্রতি রাতে (এবং admin-এর recalculate চাপলে) নতুন করে লেখা হবে; চলতি মাস
  "running" হিসেবে দেখাবে, মাস শেষ হলে locked হবে।
- ইতিমধ্যে approve/paid হয়ে যাওয়া মাস আর বদলাবে না।

## Technical notes

- DB: `profiles`-এ `referral_code`, `referred_by`, `referral_rate_usd` (nullable override),
  `referral_code_at`; নতুন টেবিল `referral_monthly_earnings`
  (referrer_id, referred_user_id, period_month, spend_usd, eligible, rate_used, commission_usd,
  status, locked_at) unique (referrer, referred, month); আর `referral_payout_requests`
  (referrer_id, amount_usd, status, admin_note, reviewed_by, wallet_txn_id)।
  সব টেবিলে GRANT + RLS: referrer শুধু নিজের row পড়বে, admin/superadmin সব; শুধু
  security-definer function দিয়ে লেখা হবে।
- Site settings: `referral_default_rate` (default 0.10), `referral_min_monthly_spend` (3000),
  `referral_enabled` (on/off toggle)।
- DB functions (SECURITY DEFINER):
  `attach_referral(code)` — signup-এর পরে referrer bind করে (self/duplicate guard),
  `recalc_referral_earnings(month)` — client_daily_stats থেকে মাসিক হিসাব লেখে,
  `request_referral_payout(amount)`, `approve_referral_payout(id)` — approve-এ
  `adjust_wallet_atomic` দিয়ে referrer wallet credit + system_logs entry।
- Frontend: `src/components/client/ClientReferral.tsx` + route `src/routes/referral.tsx`,
  `src/components/admin/AdminReferrals.tsx` + route, sidebar menu entry,
  `AuthForm.tsx`-এ `?ref=` capture (localStorage-এ রেখে Google flow-এর পরেও attach),
  Settings-এ referral rate + toggle section।
- Locked money flow (CRITICAL_LOCKED_FUNCTIONS.md) স্পর্শ করা হবে না — wallet credit
  শুধু approved atomic RPC দিয়ে।

## যা এই ধাপে করা হবে না
- Multi-level (referrer-এর referrer) commission
- Client-এর নিজে নিজে auto payout (admin approval বাধ্যতামূলক)
