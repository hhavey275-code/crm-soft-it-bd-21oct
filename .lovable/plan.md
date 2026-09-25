# External CRM Auto-pilot — 24/7 নির্ভরযোগ্য করা

## এখন যা দেখা গেছে (গত ২–৩ দিনের ডেটা)
- ১১৯টা request-এর সবগুলো শেষে completed হয়েছে, কিন্তু কিছু request সম্পন্ন হতে **৮০–৮৫ মিনিট** লেগেছে — মানে PC-র helper মাঝে মাঝে "ঘুমিয়ে" যায়, পরে জেগে কাজ করে।
- ১৮টা request CRM-এ হয়ে গেছে কিন্তু history-তে এখনো "Updating…" — Meta থেকে নতুন limit কেউ আবার পড়ে আনেনি।

## কাজের পরিকল্পনা

### ১. Helper ঘুমিয়ে না পড়া (extension v1.6.0)
- Chrome-এর ভেতরে একটা লুকানো "keep-alive" পেজ রাখা হবে, যাতে helper কখনো বন্ধ না হয় ও live connection না কাটে।
- প্রতি ৩০ সেকেন্ডে pending কিছু আছে কিনা নিজে থেকে দেখে নেবে (live সিগন্যাল মিস হলেও)।
- কাজ আটকে গেলে (tab ঝুলে থাকা) ২ মিনিট পর নিজে বাতিল করে পরের request ধরবে।

### ২. Helper online কিনা ড্যাশবোর্ডে দেখা
- helper প্রতি মিনিটে সার্ভারে "আমি চালু আছি" জানাবে।
- External Top-Up পেজে সবুজ/লাল বাতি: **Helper Online / Offline (শেষ দেখা: x মিনিট আগে)**।
- helper ৫ মিনিট offline থাকলে বা কোনো request ৫ মিনিটের বেশি pending থাকলে অ্যাডমিনকে Telegram-এ সতর্কবার্তা।
- admiki-তে login চলে গেলে (session শেষ) helper সেটা ধরবে ও "CRM-এ আবার login করুন" সতর্কবার্তা পাঠাবে।

### ৩. আটকে থাকা request নিজে ছাড়া
- কোনো request "running" অবস্থায় ১০ মিনিটের বেশি থাকলে সার্ভার সেটা আবার pending করে দেবে, যাতে helper আবার ধরতে পারে।

### ৪. Limit নিজে থেকে "Completed" হওয়া
- CRM-এ top-up সফল হলেই সার্ভার Meta থেকে নতুন limit পড়বে (কয়েক বার, ৩০ সেকেন্ড পরপর, সর্বোচ্চ ৫ মিনিট)। বাড়লে সাথে সাথে "✓ Completed"।
- এখনকার ১৮টা "Updating…" request-এর limit একবারে Meta থেকে পড়ে ঠিক করে দেওয়া হবে।

### ৫. অফিস PC-র সেটিং (আপনার দিকে একবার করতে হবে)
- Windows: Sleep = **Never**, Screen off হলেও চলবে।
- Chrome Settings → System → "Continue running background apps when Chrome is closed" **On**।
- Chrome-কে Windows startup-এ রাখা, এবং admiki-তে "Remember me" দিয়ে login রাখা।
- (পরে চাইলে) দ্বিতীয় একটা PC-তেও helper চালু রাখা যায় — দুইটা একসাথে চললেও একটা request দুইবার হবে না।

## প্রযুক্তিগত বিবরণ
- Extension: `offscreen` permission + offscreen document যা WebSocket ও heartbeat ধরে রাখে; background-এ alarm-ভিত্তিক `list_pending` fallback; tab timeout বিদ্যমান।
- `/api/public/crm-topup`: নতুন actions `heartbeat` (autopilot token দিয়ে যাচাই, `site_settings`/নতুন `autopilot_heartbeats` টেবিলে last_seen, version, crm_logged_in) ও `verify_cap`; `claim`-এর আগে ১০ মিনিটের পুরনো running claim release।
- `result` success হলে সার্ভারে `get-account-insights` দিয়ে cap পড়ে `spend_cap_after`/`limit_status=updated` সেট (bounded retries, কোনো টাইমার-কাটা নয়)।
- Offline/pending সতর্কবার্তা: বিদ্যমান ৫ মিনিটের cron-এর সাথে যুক্ত করা হবে, নতুন আলাদা polling job নয়।
- UI: `ExternalTopUpPage` এ `HelperStatusBadge`।
- zip পুনর্নির্মাণ ও download লিংক আপডেট।
