# দুই ওয়ালেটের আলাদা Due Limit

## লক্ষ্য

Main Wallet ও Secondary Wallet — প্রতিটির জন্য আলাদা due limit থাকবে, আলাদা due হিসাব দেখা যাবে, এবং Secondary টপ-আপে টাকা কোন ক্রমে কাটা হবে সেটি নির্দিষ্ট নিয়মে চলবে।

## এখনকার অবস্থা (যাচাই করা)

- ক্লায়েন্ট প্রোফাইলে একটিই due limit ফিল্ড আছে (মেয়াদ/সেট-টাইমসহ), Secondary-র জন্য আলাদা কোনো ফিল্ড নেই।
- সেই একটিই limit এখন Main ও Secondary — দুই জায়গাতেই ব্যবহার হচ্ছে।
- প্রতিটি ওয়ালেটের ব্যালেন্স আলাদা রাখা আছে, তাই ঋণাত্মক ব্যালেন্স দিয়েই সেই ওয়ালেটের due আলাদা করে বোঝা যায়।

## নতুন নিয়ম

Secondary Wallet-এ টপ-আপ চাইলে টাকা এই ক্রমে নেওয়া হবে:

1. Secondary Wallet-এর নিজের ব্যালেন্স।
2. এরপর Main Wallet-এর **বাড়তি (ধনাত্মক) ব্যালেন্স** — রেট অনুযায়ী কনভার্ট হয়ে Secondary-তে আসবে। Main-এর due limit এখানে ব্যবহার করা যাবে না।
3. তাতেও না হলে Secondary Wallet-এর নিজের due limit — এই সীমা পর্যন্ত Secondary ঋণাত্মক হতে পারবে।

Main Wallet-এ টপ-আপ চাইলে: Main ব্যালেন্স + Main-এর due limit; Secondary থেকে কিছুই টানা হবে না।

দুই limit ছাড়িয়ে গেলে "Insufficient fund" দেখাবে (অ্যাডমিনের নিজের করা টপ-আপে আগের মতোই সীমা থাকবে না)।

উদাহরণ (Secondary limit ৩০০০, Main limit ২০০০): Secondary-তে ৩০০০ due নেওয়ার পরও Main-এ যদি ৫০০ বাড়তি ব্যালেন্স থাকে, সেই ৫০০ রেট অনুযায়ী Secondary-তে এসে টপ-আপ হবে; কিন্তু Main-এর ২০০০ due limit টেনে Secondary-তে খরচ করা যাবে না।

## কী তৈরি/পরিবর্তন হবে

**১. ক্লায়েন্ট প্রোফাইলে আলাদা Secondary due limit**
নতুন ফিল্ড: secondary due limit, তার সেট-টাইম ও মেয়াদ (Main-এর মতোই auto-reset সুবিধা)।

**২. অ্যাডমিন — ক্লায়েন্ট ডিটেইল পেজ**
বর্তমান Due Limit বক্সের পাশে "Secondary Due Limit" বক্স — একইভাবে ক্লিক করে সেট, মেয়াদ নির্বাচন, লগ এবং Expired ব্যাজ।

**৩. টপ-আপের হিসাব (সার্ভার-সাইড)**
- Secondary টপ-আপ: উপরের ৩ ধাপের ক্রম বসানো হবে — Main থেকে কনভার্শনের সময় শুধু ধনাত্মক ব্যালেন্স ধরা হবে, তারপর প্রয়োজন হলে Secondary due limit।
- Main টপ-আপ: শুধু Main limit।
- মেয়াদ শেষ হওয়া limit শূন্য হিসেবে ধরা হবে (Main ও Secondary — দুটোতেই)।
- এক্সটার্নাল CRM রিকোয়েস্ট ও সাধারণ (API) টপ-আপ — দুই পথেই একই নিয়ম।

**৪. ক্লায়েন্টের পর্দা**
- ওয়ালেট পেজে দুই ওয়ালেটের আলাদা কার্ড: ব্যালেন্স, নিজের due limit, এখন কত due হয়ে গেছে, আর কত বাকি।
- টপ-আপ ডায়ালগে দেখাবে: Secondary ব্যালেন্স, Main থেকে কত আসবে, এবং কত Secondary due হবে।
- ড্যাশবোর্ডেও দুটো due আলাদা দেখাবে।

**৫. অ্যাডমিন তালিকা**
ক্লায়েন্টের due দেখানোর জায়গায় দুই ওয়ালেটের due আলাদা করে দেখানো হবে।

## কারিগরি বিবরণ

- Migration: `profiles`-এ `secondary_due_limit numeric`, `secondary_due_limit_set_at`, `secondary_due_limit_expires_at`।
- `ensure_secondary_funds`: শুধু Main-এর ধনাত্মক ব্যালেন্স কনভার্ট করবে (`p_due_limit` আর Main due টানবে না); shortfall পূরণ না হলেও error দেবে না — বাকিটা Secondary due হিসেবে থাকবে।
- `request_external_topup`: wallet অনুযায়ী limit বাছবে (`due_limit` বা `secondary_due_limit`, মেয়াদ যাচাইসহ), Secondary-র ক্ষেত্রে ensure ডেকে তারপর `secondary_balance + secondary_due_limit`-এর সাথে মিলিয়ে যাচাই করবে।
- `spend-cap-update` ফাংশন: `walletKind` অনুযায়ী due limit বাছবে; Secondary পথে ensure-এর পর `deduct_wallet_for_topup_v2`-তে `p_due_limit` = secondary due limit পাঠাবে (এখন 0 যাচ্ছে)। `tiktok-topup`-এও একই সমন্বয়।
- `ClientAdAccounts.tsx`: available = secondary balance + max(0, main balance) × রেট অনুপাত + secondary due limit; কনভার্শন ও due-র আলাদা প্রিভিউ।
- `ClientWallet.tsx`, `ClientDashboard.tsx`, `ClientDetailPage.tsx`: আলাদা limit/due প্রদর্শন ও সম্পাদনা।
