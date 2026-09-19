# তৃতীয় ওয়ালেট — Credit Line Wallet

## কী হবে

- প্রতিটি ক্লায়েন্টের জন্য তৃতীয় একটি ওয়ালেট: **Credit Line Wallet**, নিজস্ব রেট (যেমন ৳১৩২)।
- **প্রতি ক্লায়েন্টে আলাদা কম্বিনেশন:** Secondary ও Credit Line — দুটোরই আলাদা টগল। কারও শুধু Main, কারও Main + Secondary, কারও Main + Credit Line, কারও তিনটাই।
- রেট প্রতি ক্লায়েন্টে আলাদা করে সেট করা যাবে (Main ৳১২৮ / Secondary ৳১২৪ / Credit Line ৳১৩২)।
- ক্লায়েন্ট একবারে টাকা পাঠালে সেটি **শুধু তার চালু থাকা ওয়ালেটগুলোর মধ্যেই** ভাগ হবে, এই ক্রমে: **Main → Secondary → Credit Line** (বন্ধ ওয়ালেট বাদ), প্রতিটির নিজের রেটে ডলারে রূপান্তর হয়ে।
- অ্যাড অ্যাকাউন্টের সাথে তৃতীয় ওয়ালেটের জন্য আলাদা external CRM লিংক দেওয়া যাবে। ওই লিংকের বোতাম দিয়ে টপ-আপ দিলে Credit Line Wallet থেকেই ব্যালেন্স কাটবে।
- অ্যাড অ্যাকাউন্ট সেটিংসে External Top-Up টগল অন করলে এখন **তিনটি বক্স** থাকবে: Main wallet CRM link, Secondary CRM link, Credit Line CRM link। যে বক্সে লিংক দেওয়া থাকবে শুধু সেই বোতামই দেখাবে, আর সেই ওয়ালেট থেকেই কাটবে।
- Credit Line Wallet-এ ব্যালেন্স কম পড়লে Main Wallet থেকে রেট-অনুযায়ী স্বয়ংক্রিয় কনভার্ট হয়ে ঘাটতি পূরণ হবে (যেমন Secondary-তে এখন হয়)।

## কোথায় দেখা যাবে

- **ক্লায়েন্ট ডিটেইল পেজ (অ্যাডমিন):** Credit Line টগল + রেট সেট, ব্যালেন্স কার্ড (যোগ/বিয়োগ/Main → Credit Line কনভার্ট), Combined Due/Adv-এ তিনটি ওয়ালেটই যোগ হবে।
- **ক্লায়েন্ট ড্যাশবোর্ড ও ওয়ালেট পেজ:** তৃতীয় ওয়ালেটের ব্যালেন্স ও রেট, টগল অন থাকলে।
- **অ্যাড অ্যাকাউন্ট তালিকা (অ্যাডমিন ও ক্লায়েন্ট — একই নিয়ম):** External CRM-এর টপ-আপ ব্যবস্থা আগের মতোই থাকবে। যেই বক্সে লিংক দেওয়া আছে শুধু সেই একটাই বোতাম দেখাবে — Ext. Top-Up / Ext. Secondary / **Ext. Credit Line** — আর সেই বোতামের ওয়ালেট থেকেই টপ-আপ হবে।
- **Transactions/History:** প্রতিটি লেনদেনে কোন ওয়ালেট, তা দেখা যাবে।

## টেকনিক্যাল অংশ

Database (migration):
- নতুন টেবিল `credit_line_wallets` (user_id unique, balance, currency, created_at/updated_at) + GRANT + RLS (নিজের row পড়তে পারবে; admin/superadmin সব) + updated_at trigger।
- `profiles`-এ নতুন কলাম: `credit_line_wallet_enabled boolean default false`, `credit_line_usd_rate numeric`, `credit_line_due_limit numeric default 0`।
- `ad_accounts`-এ `external_topup_url_credit_line text`।
- `wallet_kind`-এর বৈধ মানে `'credit_line'` যোগ (`validate_wallet_kind` trigger function আপডেট); `transactions`, `external_topup_requests`, `top_up_requests.target_wallet` একই মান ব্যবহার করবে।
- ফাংশন আপডেট/নতুন:
  - `distribute_deposit_bdt` — শুধু চালু ওয়ালেটগুলোর মধ্যে ধাপে ধাপে (Main due → Secondary due → Credit Line due → অবশিষ্ট Main-এ advance), প্রতিটি নিজের রেটে; বন্ধ ওয়ালেট সম্পূর্ণ বাদ।
  - `deduct_wallet_for_topup_v2` — `p_wallet_kind='credit_line'` সাপোর্ট, একই advisory lock/ধার-সীমা নিয়মে।
  - `ensure_credit_line_funds` — ঘাটতি হলে Main থেকে রেট-কনভার্ট করে টানবে (`ensure_secondary_funds`-এর অনুরূপ)।
  - `admin_adjust_credit_line_wallet`, `admin_convert_main_to_credit_line` — অ্যাডমিন-only, `admin_adjust_secondary_wallet` / `admin_convert_main_to_secondary`-এর অনুরূপ।
  - `effective_due_limit` — `credit_line` kind যোগ।

Frontend:
- `src/hooks/useWallets.ts` — `creditLineBalance`, `creditLineRate`, `creditLineEnabled` যোগ; `totalBdt`-এ যোগ।
- `src/components/admin/SecondaryWalletPanel.tsx` — জেনেরিক করে তৃতীয় ওয়ালেটের Toggle/Card/Convert যোগ (`CreditLineWalletPanel`)।
- `ExternalTopUpDialog` — `walletKind` prop-এ `'credit_line'` সাপোর্ট; কল-সাইটে বোতাম গেটিং `external_topup_url_credit_line` থাকলে।
- বোতাম যোগ: `AdminAdAccounts.tsx`, `AdAccountDetailPage.tsx`, `ClientDetailPage.tsx`, `ClientAdAccounts.tsx` — বিদ্যমান primary/secondary প্যাটার্ন অনুসরণ করে।
- `ExternalTopUpConfigSection.tsx` — তৃতীয় CRM URL ইনপুট।
- `src/routes/api/public/crm-topup.ts` ও helper automation — `wallet_kind='credit_line'` পাস-থ্রু (নতুন লজিক নয়, শুধু নতুন মান গ্রহণ)।
- `TransactionHistoryPanel.tsx`, `MonthlyUsageExport.tsx`, `InvoicePage.tsx` — নতুন wallet label।

## যাচাই

- টগল বন্ধ ক্লায়েন্টে আগের আচরণ হুবহু অপরিবর্তিত।
- টগল চালু ক্লায়েন্টে: ডিপোজিট তিন ধাপে ঠিকভাবে বসছে, রেট-হিসাব মিলছে।
- Credit Line লিংকযুক্ত অ্যাকাউন্টে টপ-আপে ওই ওয়ালেট থেকেই কাটছে; ব্যালেন্স কম হলে Main থেকে অটো কনভার্ট।
- একসাথে দুইটি টপ-আপে ডাবল কাটা হচ্ছে না (lock পরীক্ষা)।
