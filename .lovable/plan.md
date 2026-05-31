## Problem

Telegram-এ Seller Payment / USDT Given / Withdraw forward হওয়ার সময় শুধু seller-এর নাম দেখাচ্ছে — কে (কোন admin বা seller নিজে) entry submit করেছে সেটা message-এ নেই। Screenshot-এ "Faisal kabir" হচ্ছে seller, কিন্তু কোন admin এই entry টা দিল সেটা কোথাও দেখাচ্ছে না।

## Goal

প্রতিটা forwarded seller transaction message-এ একটা নতুন line যোগ করব:

`📥 Entry by: <admin/seller name>`

যাতে যে-ই submit করুক (admin on behalf of seller, অথবা seller নিজে), তার নাম clearly দেখা যায়।

## Changes

### 1. `supabase/functions/forward-seller-proof/index.ts`

- Seller transaction row fetch করার সময় (already fetched at line ~108 for `telegram_forwarded` check) `entry_by_name`, `reviewed_by` ও select করব।
- যদি `entry_by_name` থাকে — সেটাই use করব।
- না থাকলে fallback: `reviewed_by` (admin user_id) → `profiles.full_name / email` lookup করে resolve করব।
- শেষেও কিছু না পেলে line টা skip করব (কোন "Unknown" দেখাব না)।
- তিনটা caption branch-এই (`usdt_received`, `withdraw`, `bdt_payment`) seller name line-এর ঠিক পরে `📥 Entry by: …` insert করব।

### 2. Caller pages — entry_by_name নিশ্চিত করা

`SellerSubmitUsdtDialog.tsx`-এ already submitter name resolve করে save করা হয়। একই pattern apply করব:

- `src/components/admin/AdminSellers.tsx` — admin যেসব জায়গা থেকে seller_transactions insert/approve করে (BDT payment add, withdraw approve সহ) সেখানে insert-এর সময় logged-in admin-এর `full_name / email` থেকে `entry_by_name` populate করব (যদি ইতিমধ্যে না হয়)।
- `src/components/seller/SellerWithdrawRequest.tsx` — seller নিজের নাম `entry_by_name`-এ save করব।

কোন business logic change নেই — শুধু একটা informational field populate ও Telegram caption-এ একটা line add।

## Out of scope

- "🏦 Unknown — N/A" bank line (screenshot-এ লাল circle): এটা bank info, আলাদা bug (Others-path-এ bank name না পাঠানো)। এই plan-এ touch করছি না — চাইলে পরে আলাদাভাবে ঠিক করব।
- Existing locked dedupe / OCR / approval logic-এ কোন পরিবর্তন নেই।

## Result

Telegram message এখন দেখাবে:

```
💰 Seller Payment
👤 Faisal kabir
📥 Entry by: <admin name>
🏦 City Bank — 1502944865001
৳650,000
🔖 Ref: …
```
