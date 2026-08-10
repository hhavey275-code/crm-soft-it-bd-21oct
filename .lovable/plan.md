# Secondary Wallet-এ Payment জমা করার Plan

এখন client payment দিলে টাকা সব সময় **Main wallet**-এ জমা হয় (secondary-র due থাকলে শুধু সেটা adjust হয়)। লক্ষ্য: client চাইলে payment সরাসরি **Secondary wallet**-এ জমা করতে পারবে।

## Client যা দেখবে

- Top-up form-এ (যাদের secondary wallet on আছে) একটা ছোট selector: **"Deposit To: Main wallet / Secondary wallet"**।
- Secondary বেছে নিলে:
  - USD conversion secondary rate দিয়ে হবে (main rate নয়)।
  - Allocation breakdown বদলাবে: আগে **Secondary wallet due** adjust → তারপর sheet/card bill → বাকি টাকা **Secondary wallet-এ জমা হবে** (Main wallet due এই ক্ষেত্রে touch করবে না, নাকি করবে — নিচের Decision দেখুন)।
- Main বেছে নিলে বর্তমান behaviour হুবহু আগের মতোই থাকবে (কোনো regression নয়)।
- যাদের secondary wallet off, তারা কোনো selector দেখবে না।

## Admin যা দেখবে

- Top-up request list ও approve dialog-এ একটা badge: **Main** / **Secondary (Sheet rate)**, সাথে ওই wallet-এর rate।
- Approve করার সময় admin badge অনুযায়ী টাকা ঠিক wallet-এ যাবে; admin চাইলে approve-এর আগে wallet বদলাতেও পারবে (dropdown)।

## Approval-এ টাকা কোথায় যাবে

Approve করলে:
1. Target wallet = request-এ সেভ করা wallet (default `primary`)।
2. Secondary হলে: secondary rate দিয়ে USD বের হবে, `secondary_wallets.balance` বাড়বে, ledger row-এ `wallet_kind='secondary'` থাকবে।
3. Main হলে: বর্তমান flow (main due → sheet bill → main credit + `settle_secondary_from_main`) অপরিবর্তিত।
4. Duplicate-credit protection ও invoice generation দুই ক্ষেত্রেই আগের মতোই কাজ করবে।

## Transaction history

- নতুন credit row secondary tab-এ দেখাবে (filter আগেই আছে)।
- Description-এ থাকবে: `Wallet top-up approved (Secondary wallet)` + rate।
- Summary bar-এর Main/Secondary split স্বয়ংক্রিয়ভাবে ঠিক দেখাবে।

## Technical notes

- Migration: `top_up_requests`-এ নতুন column `target_wallet text not null default 'primary'` (check: `primary`/`secondary`) + একই migration-এ প্রয়োজনীয় GRANT/policy অপরিবর্তিত থাকবে।
- Credit করার জন্য নতুন security-definer RPC `credit_wallet_for_payment(p_user_id, p_amount, p_wallet_kind, p_reference_id, p_description, p_processed_by)` — ledger row আগে insert, তারপর ব্যালেন্স update, যেন balance drift/phantom balance আর না হয় (top-up deduction-এর মতোই atomic)।
- Client: `src/components/client/ClientTopUp.tsx` — wallet selector state, rate নির্বাচন, `alloc` hook-এ secondary branch, `AllocationBreakdown`-এ label বদল, insert-এ `target_wallet`।
- Admin: `src/components/admin/AdminTopUp.tsx` — approve path-এ `target_wallet` পড়ে secondary হলে নতুন RPC কল, main হলে বর্তমান কোড; dialog-এ badge + optional wallet override।
- `useWallets` hook-এ কোনো পরিবর্তন লাগবে না।

## Decision দরকার (একটা বেছে দিন)

1. **Strict**: Secondary বেছে নিলে main wallet-এর due একদমই adjust হবে না — পুরো টাকা secondary-তে।
2. **Safe (recommended)**: Secondary বেছে নিলেও আগে main wallet-এর due (থাকলে) adjust হবে, বাকিটা secondary-তে জমা হবে — যাতে CRM due জমে না যায়।
