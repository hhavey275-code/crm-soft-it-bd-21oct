# এক Campaign-এ একাধিক Ad set ও Ad

এখন My Ads-এর create wizard-এ একটা campaign-এ ঠিক ১টা ad set আর ১টা ad বানানো যায়। এই কাজের পর Facebook Ads Manager-এর মতো একটা campaign-এর নিচে যত খুশি ad set, আর প্রতিটা ad set-এর নিচে যত খুশি ad বানানো যাবে।

## ১. Wizard-এর ভেতরে (ManagedCreateWizard)

- Ad set-এর সব তথ্য (নাম, budget, schedule, audience, conversion, pixel ইত্যাদি) আর ad-এর সব তথ্য (নাম, post/creative, ছবি/ভিডিও, text, button, link) — এখন যেগুলো একটার জন্য আছে, সেগুলো হবে তালিকা আকারে: প্রতিটা ad set-এর নিজস্ব তথ্য, আর প্রতিটা ad set-এর ভেতরে ad-এর তালিকা।
- বাম পাশের tree-তে (ও মোবাইলের উপরের ধাপে) দেখা যাবে: Campaign → Ad set 1, Ad set 2… → প্রতিটার নিচে Ad 1, Ad 2… — Facebook-এর মতোই।
- **"+ Ad set যোগ করুন"** বাটন: নতুন ad set খুলবে, আগের ad set-এর audience/budget কপি হয়ে আসবে (বদলে নেওয়া যাবে)।
- **"+ Ad যোগ করুন"** বাটন: সেই ad set-এর নিচে নতুন ad খুলবে।
- প্রতিটা ad set ও ad-এ **মুছে ফেলার** বাটন থাকবে (শেষটা মোছা যাবে না)।
- Campaign-এর তথ্য (নাম, budget level, bid strategy, special category) আগের মতোই একটাই থাকবে।
- Budget যদি campaign level-এ হয় (Advantage+ campaign budget), সব ad set সেই budget ভাগ করে নেবে; ad set level budget হলে প্রতিটা ad set-এর নিজের budget দেওয়া যাবে।
- কোন ad set/ad-এ তথ্য অপূর্ণ আছে, tree-তে লাল দাগ দেখাবে আর publish-এর আগে সবগুলো ঠিক করতে বলবে।
- Draft (আধা-লেখা campaign) আগের মতোই save হবে — এখন একাধিক ad set/ad-সহ।

## ২. Server-এ (api.managed-ads)

- এখন এক ডাকে ১ campaign + ১ ad set + ১ ad তৈরি হয়। এটা বদলে হবে: এক ডাকে ১ campaign + N ad set + প্রতিটার N ad।
- পুরোনো নিয়ম অক্ষত: প্রথমে ad account চালু কি না ও Page access যাচাই; shared account হলে wallet-এ যথেষ্ট balance আছে কি না (মোট budget-এর হিসাব); ownership check একই থাকবে।
- কোনো একটা ad set/ad বানাতে গিয়ে Facebook ভুল দিলে পুরো campaign-টা মুছে দেওয়া হবে (আধবাটা campaign যেন Facebook-এ না পড়ে থাকে) — এখন যেমন হয়।
- পুরোনো ১-adset ফরম্যাটেও ডাকা যাবে, যাতে অন্য কোনো জায়গা ভাঙে না।

## ৩. যা বদলাবে না

- Campaign list, report, delete, status change — সব আগের মতোই; ওগুলো ইতোমধ্যে এক campaign-এর অনেক ad set/ad দেখাতে পারে।
- Wallet charge ও ownership নিয়ম একই থাকবে।
- Database-এ কোনো বদল নেই।

## যাচাই

- Wizard খুলে ২টা ad set ও প্রতিটায় ২টা করে ad যোগ করে publish/draft করার flow build error ছাড়া চলে কি না।
- অপূর্ণ ad set/ad থাকলে publish আটকায় কি না।
- Type check ও build পাস করে কি না।
