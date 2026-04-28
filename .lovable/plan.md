## সমস্যা কী

আজ ১১:৫৭-এ ৪০,০০০ টাকার auto-approved top-up (request `a762748c…`, Southeast Bank a/c `…2685`) Telegram-এ forward হয়েছে, কিন্তু caption-এ "Total: Advance/Due" line আসেনি।

## কারণ (root cause)

`verify-topup` edge function-এ Total balance শুধু তখনই বসে যখন payment-এর সাথে যুক্ত `bank_account` row-এর `seller_id` set করা থাকে। ওই Southeast Bank account-এর (`08e14766…`) `seller_id = NULL`, তাই:

1. Code `sellerId` resolve করতে পারেনি
2. `seller_transactions`-এ কোনো ledger row-ই insert হয়নি (৪০,০০০ ledger-এ নেই)
3. Total line skip হয়ে গেছে

অর্থাৎ এটা শুধু caption issue না — ওই ৪০,০০০ টাকা কোনো seller-এর running balance-এও যোগ হয়নি।

## ফিক্স প্ল্যান

### ১. Bank-এর owner খুঁজে বের করো (data fix)
Southeast Bank `…2685` (`08e14766-a7df-4c0d-a3a4-9986ee76d622`)-এর actual seller কে — সেটা confirm করে `bank_accounts.seller_id` update করতে হবে। অন্য কোন bank account-গুলোর `seller_id` NULL সেটাও audit করব।

### ২. Missing ledger entry তৈরি করো
`a762748c…` request-এর জন্য `seller_transactions`-এ একটা approved `client_topup` row insert করব (৪০,০০০, ঠিক seller-এর নামে), যাতে balance ঠিক হয়।

### ৩. Code hardening — `verify-topup/index.ts`
- যখন `bank_accounts.seller_id` NULL, fallback হিসেবে `site_settings`-এর default seller বা একটা configurable "house seller" use করব (অথবা admin notification পাঠাব যাতে missed না হয়)
- কমপক্ষে একটা warning log + admin notification fire করব যখন auto-approved top-up-এর bank-এর কোনো seller নাই, যাতে ভবিষ্যতে silent miss না হয়

### ৪. Verification
Fix-এর পর ওই forwarded message edit করা যাবে না, কিন্তু seller-এর dashboard/AdminSellers-এ balance যাচাই করব যে ৪০,০০০ properly যোগ হয়েছে।

## কোন ফাইল পরিবর্তন হবে

- `supabase/functions/verify-topup/index.ts` — NULL-seller fallback + warning
- Database migration — `bank_accounts.seller_id` set + missing `seller_transactions` row insert

## যা জানা দরকার

ওই Southeast Bank account `…2685`-এর owner কে — কোন seller-এর নামে এই ৪০,০০০ যোগ হবে? (Approve করলে আমি database-এ অন্য bank-গুলোর seller mapping দেখে best match suggest করব, অথবা আপনি seller-এর নাম দিলে ওটা ব্যবহার করব।)
