
# Extension v1.3.0 — Hidden Limit, Cards Sync, Account Filtering, Card Removal

আপনার ৩টা মূল সমস্যা ঠিক করব। সব পরিবর্তন **শুধু extension + ingest function এ** — CRM UI প্রায় একই থাকবে, শুধু Payment Methods card-list টা auto-update হবে sync এর সাথে।

---

## ১. Hidden Limit (আসল spending limit) সঠিকভাবে আনা

**সমস্যা:** এখন extension `adtrust_dsl` field পাঠাচ্ছে, যেটা অনেক সময় Meta's *advertised* limit (250) দেখায়, কিন্তু আসল hidden cap (134.52) আলাদা।

**সমাধান:** SMIT.vn যেভাবে দুটোই দেখায়, সেভাবে দুটো field ই request করব Graph API থেকে:
- `adtrust_dsl` → "Limit" (250)
- `min_daily_budget` / `spend_cap` সহ আরো signal চেক করে **আসল hidden limit** নেব। প্রধানত billing endpoint `/act_<id>?fields=adtrust_dsl,balance,amount_spent,spend_cap,min_daily_budget,custom_audience_info,end_advertiser` থেকে যেটা সবচেয়ে নিচু/restrictive number সেটাই hidden limit হিসেবে রাখব (SMIT এই same approach ব্যবহার করে)।
- Backend এ `ad_account_insights` এ নতুন column `hidden_daily_limit` যোগ করব এবং CRM detail page এ "Hidden Limit" row দেখাবো।

**API call নিয়ে আপনার প্রশ্ন:** API call বাড়ানো না — same `/act_<id>` endpoint, শুধু একটু বেশি fields। এটা SMIT এর মতই — user session token দিয়ে call হয়, আপনার Graph rate limit এ effect পড়বে না।

---

## ২. Cards CRM এ auto-আসা না — ঠিক করব

**সমস্যা:** Payment Methods section এ cards তখনই দেখায় যখন CRM থেকে "Sync Now" চাপা হয়। Extension থেকে আসা cards সরাসরি ওখানে দেখায় না।

**সমাধান:** ingest-dsl function এ আগে থেকেই `syncIncomingCards` আছে যেটা `ad_account_cards`, `ad_account_card_assignments`, `ad_account_last_known_state` table এ লিখে। কিন্তু `AdAccountPaymentMethods.tsx` সেগুলো না দেখে edge function `list_account_cards` থেকে live Graph call করছে।

ঠিক করব:
- `AdAccountPaymentMethods.tsx`: প্রথমে `ad_account_last_known_state.cards` (extension যেটা দিয়েছে) থেকে cards দেখাবো। Live `list_account_cards` call হবে fallback / refresh হিসেবে, default এ DB-cached cards দেখাবে।
- ফলে extension যখনই sync করবে (auto প্রতি ১ ঘন্টা / ৬ ঘন্টা) — CRM এ cards সাথে সাথে চলে আসবে, কোনো manual action লাগবে না।

---

## ৩. Sync শুধু CRM এর accounts এর জন্য (sync speed + accuracy)

**সমস্যা:** এখন extension Facebook এ সব ad account scan করে — যেগুলো CRM এ নেই সেগুলোও। ফলে slow + অযথা data।

**সমাধান:**
- Extension first call করবে নতুন backend endpoint `list-managed-accounts` → CRM এ existing সব `account_id` এর list ফেরত দেবে (small payload)।
- তারপর শুধু সেই account গুলোর জন্যই Graph API hit করবে (`/act_<id>?fields=...` — direct, BM scan লাগবে না)।
- Result: অনেক কম API call, অনেক fast sync, accurate data।

**Extension এ কোন API key লাগবে না** — আগে যেমন user JWT দিয়ে call হচ্ছিল, এখনও তাই। শুধু এখন CRM-known account গুলোর জন্যই।

---

## ৪. Extension থেকে Card Remove করার option

**সমস্যা:** SMIT এর extension billing page এ open হয়ে inline card-remove button দেখায়, login session এর data দিয়ে।

**সমাধান:**
- `content.js` কে enhance করব: যখন user `business.facebook.com/billing_hub/accounts/details?asset_id=...` page এ থাকে, content script ওই page এর payment methods list এর পাশে আমাদের একটা ছোট "Remove (CRM)" button inject করবে।
- Click করলে Graph API DELETE call হবে user session token দিয়ে: `DELETE /act_<id>/payment_methods/<funding_source_id>`।
- Success হলে CRM এও notify পাঠাবে যাতে `ad_account_cards` snapshot update হয় সাথে সাথে।
- Existing CRM "Remove" button (`AdAccountPaymentMethods.tsx` এর `removeMutation`) ও same Graph DELETE call এর উপর depend করে — সেটা already আছে edge function `manage-ad-account-partners` এ। শুধু extension থেকেও same kaaj করা যাবে।

---

## Technical Files

**Extension:**
- `extension/manifest.json` — version → `1.3.0`, content script এ billing_hub URL pattern যোগ
- `extension/background.js` + `extension/popup.js` — managed-accounts endpoint call করে শুধু সেগুলোর জন্যই Graph fetch, hidden limit fields যোগ
- `extension/content.js` — billing_hub page এ "Remove" button inject + Graph DELETE handler
- `public/dsl-sync-extension.zip` — re-zip

**Frontend:**
- `src/components/pages/AdAccountDetailPage.tsx` — button label `v1.3.0`, hidden limit row দেখানো
- `src/components/admin/AdAccountPaymentMethods.tsx` — DB-cached cards (`ad_account_last_known_state`) primary source হবে

**Backend:**
- New edge function `list-managed-accounts` — admin role check করে DB থেকে সব ad_accounts এর `account_id` array return করে
- `supabase/functions/ingest-dsl/index.ts` — `hidden_daily_limit` field accept করে `ad_account_insights` এ save
- Migration: `ad_account_insights` এ `hidden_daily_limit numeric` column যোগ
