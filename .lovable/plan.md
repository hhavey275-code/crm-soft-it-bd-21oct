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

### ৪. ক্লায়েন্ট ৩০ সেকেন্ডের মধ্যে পরিষ্কার ফলাফল দেখবে
ক্লায়েন্ট কখনো "হয়ে গেছে" দেখে পরে "হয়নি" দেখবে না — এটাই মূল নিয়ম।

- **Submit-এর আগেই যাচাই:** helper offline থাকলে বা SIBD বন্ধ থাকলে ক্লায়েন্ট submit-ই করতে পারবে না, পরিষ্কার লেখা দেখবে "এই মুহূর্তে top-up নেওয়া যাচ্ছে না, একটু পরে চেষ্টা করুন"। টাকা কাটবে না।
- **Submit-এর পর (০–৩০ সেকেন্ড):** ক্লায়েন্ট একটা progress দেখবে ("Top-up চলছে…", কাউন্টডাউন সহ)।
- **CRM সফল বললে:** সাথে সাথে "✓ Top-up সম্পন্ন — $X যোগ হয়েছে" দেখাবে। CRM-এর নিজস্ব সফলতার বার্তাই প্রমাণ, কারণ admiki সফল বললে limit সত্যিই বাড়ে (Meta-তে দেখাতে কখনো দেরি হয়, সেটা ক্লায়েন্টের জন্য বাধা হবে না)।
- **CRM ব্যর্থ বা ৩০ সেকেন্ডে উত্তর না এলে:** "✗ Top-up হয়নি — টাকা wallet-এ ফেরত দেওয়া হয়েছে" দেখাবে, আর কাটা টাকা সাথে সাথে ফেরত যাবে। ক্লায়েন্ট আবার চেষ্টা করতে পারবে।
- **ভুল error রোধ:** "ব্যর্থ" বলার আগে সার্ভার একবার Meta থেকে limit দেখবে (কয়েক সেকেন্ড)। limit বেড়ে থাকলে সেটা সফল ধরা হবে, টাকা ফেরত যাবে না, আপনাকে manual করতে হবে না।
- **দুই দিকের নিরাপত্তা (শুধু অ্যাডমিন দেখবে, ক্লায়েন্ট নয়):**
  - টাকা ফেরত দেওয়ার পরে যদি Meta-তে limit বাড়া দেখা যায় (দেরিতে হয়ে গেছে), অ্যাডমিনকে সতর্কবার্তা যাবে — সিদ্ধান্ত আপনি নেবেন, ক্লায়েন্টের কাছে কিছু উল্টাবে না।
  - "সম্পন্ন" দেখানোর পর ১০ মিনিটেও Meta-তে limit না বাড়লে অ্যাডমিনকে সতর্কবার্তা (admiki চেক করার জন্য)।
- History-তে পরে "Update from Meta" বা sync হলে, Updating অবস্থার request-গুলো limit মিললে নিজে থেকে old → new limit সহ Completed হবে।
- এখনকার ১৮টা "Updating…" request-এর limit একবারে Meta থেকে পড়ে ঠিক করে দেওয়া হবে।

### ৫. অফিস PC-র সেটিং (আপনার দিকে একবার করতে হবে)
- Windows: Sleep = **Never**, Screen off হলেও চলবে।
- Chrome Settings → System → "Continue running background apps when Chrome is closed" **On**।
- Chrome-কে Windows startup-এ রাখা, এবং admiki-তে "Remember me" দিয়ে login রাখা।
- (পরে চাইলে) দ্বিতীয় একটা PC-তেও helper চালু রাখা যায় — দুইটা একসাথে চললেও একটা request দুইবার হবে না।

## প্রযুক্তিগত বিবরণ
- Extension: `offscreen` permission + offscreen document যা WebSocket ও heartbeat ধরে রাখে; background-এ alarm-ভিত্তিক `list_pending` fallback; tab timeout বিদ্যমান।
- `/api/public/crm-topup`: নতুন actions `heartbeat` (autopilot token দিয়ে যাচাই, `site_settings`/নতুন `autopilot_heartbeats` টেবিলে last_seen, version, crm_logged_in) ও `verify_cap`; `claim`-এর আগে ১০ মিনিটের পুরনো running claim release।
- `result` success → request completed; সার্ভার `get-account-insights` দিয়ে cap পড়ে `spend_cap_after`/`limit_status=updated` সেট, পরে না বাড়লে অ্যাডমিন অ্যালার্ট।
- `result` failure বা ৩০s deadline পার → একবার Meta cap চেক; বাড়েনি হলে `fail_external_topup` দিয়ে wallet refund ও status `failed`।
- ক্লায়েন্ট dialog realtime/৩ সেকেন্ড অন্তর request status দেখবে; `request_external_topup` RPC helper heartbeat ৯০s-এর পুরনো হলে reject করবে।
- Extension-এ প্রতি request-এর timeout ১২০s থেকে ২৫s।
- Offline/pending সতর্কবার্তা: বিদ্যমান ৫ মিনিটের cron-এর সাথে যুক্ত করা হবে, নতুন আলাদা polling job নয়।
- UI: `ExternalTopUpPage` এ `HelperStatusBadge`।
- zip পুনর্নির্মাণ ও download লিংক আপডেট।
