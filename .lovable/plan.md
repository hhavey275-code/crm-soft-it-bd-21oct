# মোবাইল (Kiwi browser) থেকে এক চাপে External Top-Up

## লক্ষ্য
PC না চললেও অ্যাডমিন ফোনে pending request দেখে "Approve & Top-Up" চাপবেন। তখন Kiwi-তে helper নিজে admiki খুলে top-up করবে, limit মিলিয়ে Completed করবে।

## যা হবে

### ১. Pending এলেই ফোনে জানানো
- নতুন external top-up request এলে অ্যাডমিনের ফোনে push notification যাবে: "AU958 — $50 pending"। ট্যাপ করলে সরাসরি External Top-Up পেজ খুলবে।
- ৩ মিনিটেও কেউ না ধরলে আরেকবার মনে করিয়ে দেবে।

### ২. মোবাইলে সহজ External Top-Up পেজ
- প্রতিটা pending request বড় কার্ডে দেখাবে: অ্যাকাউন্টের নাম, টাকা, কোন wallet, কত মিনিট ধরে pending।
- প্রতিটা কার্ডে বড় একটা **"Approve & Top-Up"** বাটন থাকবে। চাপলে নতুন tab-এ admiki খুলবে, helper নিজে amount বসিয়ে submit করবে।
- শেষ হলে পেজে ফিরে সবুজ "✓ Completed (old → new limit)" দেখাবে। ব্যর্থ হলে লাল লেখায় কারণ আর "আবার চেষ্টা" বাটন থাকবে।
- PC-র Auto-pilot আগে ধরে ফেললে মোবাইলের বাটন নিজে থেকে বন্ধ হয়ে যাবে, তাই একই top-up দুইবার হবে না।

### ৩. Helper Kiwi-তে চলার উপযোগী করা (v1.6.0)
- **Token-এর ঘর না আসার সমাধান:** Kiwi-তে helper-এর ছোট popup ঠিকমতো খোলে না। তাই দুটো নতুন উপায় থাকবে:
  - অ্যাপের External Top-Up পেজে **"এই ফোনে Auto-pilot চালু করুন"** বাটন। চাপলেই token নিজে helper-এ বসে যাবে, কিছু copy-paste করতে হবে না।
  - Kiwi-র extension তালিকায় helper-এর **"Settings" পুরো পেজে** খুলবে, সেখানে বড় token-এর ঘর থাকবে।
- ফোনে admiki-র পেজ ছোট দেখায়, তাই helper মোবাইল layout-এও বাটন ও ঘর খুঁজে নেবে।
- মোবাইলে যা নেই (desktop notification, background) সেগুলোর জন্য আর আটকাবে না। ফলাফল পেজেই দেখাবে।
- ফোন থেকে সহজে ডাউনলোড করে Kiwi-তে বসানোর নির্দেশনা পেজেই দেওয়া থাকবে।

### ৪. Limit নিজে মিলিয়ে দেওয়া (ভুল error বন্ধ)
- helper সফল বললে বা error দিলেও সার্ভার একবার Meta থেকে limit দেখবে। বেড়ে থাকলে নিজে থেকে "✓ Completed" হবে, আপনাকে আর manual করতে হবে না।
- এখন history-তে যেসব request "Updating…" হয়ে আছে, সেগুলো একবারে Meta থেকে মিলিয়ে ঠিক করা হবে।

## আপনার দিকে একবার যা করতে হবে
- ফোনে Kiwi (বা Lemur) browser ইনস্টল করা।
- সেখানে helper-এর zip ফাইল বসানো, আর admiki-তে "Remember me" দিয়ে login রাখা।
- অ্যাপে অ্যাডমিন হিসেবে notification চালু করা।

## প্রযুক্তিগত বিবরণ
- Push: `notify_admins_on_external_topup_request` ট্রিগারে বিদ্যমান `send-push-notification`, URL `/external-top-up`। Reminder বিদ্যমান ৫-মিনিটের cron-এ যোগ হবে, নতুন polling job নয়।
- `AdminExternalTopUpRequests.tsx`: মোবাইল কার্ড layout। "Approve & Top-Up" বিদ্যমান `createCrmTopUpJob` ব্যবহার করে `#crmtopup=` লিংক খুলবে। realtime দিয়ে status দেখাবে। `automation_started_at` < ৩ মিনিট হলে বাটন বন্ধ থাকবে।
- `crm-topup-extension/content.js`: selector fallback (মোবাইলে viewport, hidden menu)। `chrome.notifications`, `alarms` try/catch-এ মোড়ানো। ফলাফল `result` API-তে যাবে।
- `/api/public/crm-topup` `result`: success বা failure দুই ক্ষেত্রেই `get-account-insights` দিয়ে cap চেক, বাড়লে `spend_cap_after` + `limit_status=updated` + completed। একবারের backfill চলবে পুরনো pending-limit request-গুলোর জন্য।
- zip rebuild, version 1.6.0।
