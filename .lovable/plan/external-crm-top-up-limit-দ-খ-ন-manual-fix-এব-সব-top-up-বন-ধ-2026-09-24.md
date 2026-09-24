# External CRM top-up: limit দেখানো, manual fix, এবং সব top-up বন্ধের সুইচ

## ১. Transaction-এ limit কত থেকে কত হলো দেখানো
- প্রতিটা external top-up (Main / Secondary / Credit Line) request-এর সাথে top-up দেওয়ার সময়ের spend cap ("আগের limit") সেভ করা হবে।
- Helper top-up শেষ করার পর, অথবা Meta sync-এ নতুন limit এলে, "নতুন limit" সেভ হবে।
- Client-এর Transaction history ও Ad Account পাতায় প্রতিটা external top-up-এর পাশে দেখাবে:
  `Limit: $1,200 → $1,700` (সবুজ = updated, হলুদ = "Updating…", লাল = "Limit বাড়েনি")।
- একটা নির্দিষ্ট সময় (যেমন ৩০ মিনিট) পরেও limit না বাড়লে status "Limit বাড়েনি" হবে, আর admin-এর External Top-Up পাতায় সতর্কবার্তা আসবে।

## ২. Top-up ব্যর্থ হলে admin-এর manual fix যেন দেখা যায়
- Admin-এর External Top-Up পাতায় প্রতিটা ব্যর্থ/অনিশ্চিত request-এ একটা **"Manually done"** বোতাম।
- চাপলে admin নতুন limit লিখবে (অথবা "Meta থেকে আনুন" চাপলে সরাসরি Meta-র বর্তমান limit আসবে)।
- তখন ওই request "Completed (manual)" হবে, আর client-এর transaction-এ একই ভাবে `Limit: আগের → নতুন` দেখাবে, সাথে ছোট লেবেল "Admin দ্বারা সম্পন্ন"।
- Wallet থেকে আবার টাকা কাটবে না (আগেই কাটা হয়েছে); শুধু record ঠিক হবে।
- CRM-এ top-up একেবারেই না হলে admin "Refund" করতে পারবে — wallet-এ টাকা ফেরত যাবে।

## ৩. External CRM-এর সব top-up এক বোতামে বন্ধ/চালু
- Settings / External Top-Up পাতায় প্রতিটা CRM-এর নামে একটা **On/Off সুইচ** (যেমন "Admiki — Top-up চালু")। সাথে ঐচ্ছিক বার্তা, যেমন "CRM-এ balance load হচ্ছে, কিছুক্ষণ পরে চেষ্টা করুন"।
- Off থাকলে:
  - ওই CRM-এর সব client-এর dashboard ও Ad Accounts পাতা থেকে External / Secondary / Credit Line Top Up বোতাম **পুরোপুরি লুকানো** থাকবে (চাইলে বোতামের জায়গায় ছোট বার্তা দেখানো যাবে)।
  - Server-ও request গ্রহণ করবে না — কেউ পুরনো পাতা খোলা রেখে চেষ্টা করলেও টাকা কাটবে না।
  - Admin চাইলে নিজে top-up করতে পারবে (বা সেটাও বন্ধ থাকবে — নিচের প্রশ্ন দেখুন)।
- চালু করলেই সাথে সাথে সবার বোতাম ফিরে আসবে।

## Technical details
- `external_topup_requests`-এ নতুন column: `spend_cap_before`, `spend_cap_after`, `limit_status` (`pending|updated|not_updated|manual`), `manual_note`।
- `request_external_topup` ও `ExternalTopUpDialog` insert-এর সময় `ad_accounts.spend_cap` থেকে `spend_cap_before` সেট করবে; `crm-topup.ts` `result` action ও Meta sync (spend-cap-update / useLimitUpdateWatch) `spend_cap_after` + `limit_status='updated'` সেট করবে।
- নতুন RPC `admin_mark_external_topup_manual(p_id, p_new_cap, p_note)` ও `refund_external_topup(p_id)` — has_role দিয়ে admin চেক।
- নতুন টেবিল `external_crm_status` (`crm_name` PK, `enabled`, `message`, `updated_by`, `updated_at`) + GRANT + RLS (সবাই পড়তে পারবে, শুধু admin লিখবে)। `request_external_topup` ও autopilot-এ disabled হলে reject।
- Client UI (`ClientAdAccounts`, `ClientDashboard`, wallet cards) `external_crm_status` query করে বোতাম লুকাবে; Realtime দিয়ে সাথে সাথে আপডেট।
- TransactionHistoryPanel / ClientTransactions-এ `reference_id` দিয়ে request join করে limit দেখানো।
