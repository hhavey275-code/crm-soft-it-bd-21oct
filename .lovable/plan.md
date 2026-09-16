# দুই ওয়ালেটের রেট সমন্বয় — অটো কনভার্ট

## সমস্যা

ক্লায়েন্ট টাকা পাঠালে সেটা সবসময় Main wallet-এ জমা হয় (Secondary-তে শুধু due শোধ হয়)। কিন্তু কিছু অ্যাড অ্যাকাউন্ট Secondary wallet থেকে টপ-আপ হয়, আর Secondary-র ডলার রেট আলাদা (সাধারণত বেশি)। ফলে Main-এ টাকা থাকলেও Secondary টপ-আপে "Insufficient fund" আসে।

## সমাধান (এক লাইনে)

Secondary টপ-আপের সময় Secondary-তে যা কম পড়ে, ঠিক ততটুকুই Main থেকে **নিজে থেকেই রেট অনুযায়ী কনভার্ট** হয়ে কেটে যাবে। ক্লায়েন্টকে আলাদা কিছু করতে হবে না; হিসাব ইতিহাসে প্রতিটি কনভার্শন আলাদা লাইনে দেখা যাবে।

## রেট হিসাব

উদাহরণ: Main রেট ৳১২০, Secondary রেট ৳১৩০।
- Secondary-তে $২০ দরকার, আছে $০ → Main থেকে কাটবে ২০ × ১৩০ ÷ ১২০ = **$21.67**
- অর্থাৎ টাকার (৳) মান সমান থাকবে, শুধু ডলার সংখ্যা রেট অনুযায়ী বদলাবে।

## কোথায় কী হবে

**১) ক্লায়েন্ট টপ-আপ (Secondary অ্যাকাউন্ট)**
- ডায়ালগে "Available" হিসেবে দেখাবে: Secondary balance + Main থেকে কনভার্ট করে পাওয়া সম্ভব পরিমাণ (due limit ধরে)।
- Amount দিলে নিচে ছোট করে লেখা থাকবে: "Main থেকে $21.67 কনভার্ট হবে (৳১২০ → ৳১৩০)"।
- মোট সীমা পার হলে আগের মতোই "Insufficient fund" আসবে — ক্লায়েন্টের নিয়ম বদলাচ্ছে না।

**২) অ্যাডমিন টপ-আপ (External CRM ও সাধারণ)**
- আগের মতোই কোনো বাধা থাকবে না; দরকার হলে কনভার্ট হবে, আর টাকা না থাকলে Main wallet due (negative) হয়ে যাবে।

**৩) অ্যাডমিন ম্যানুয়াল ট্রান্সফার**
- ক্লায়েন্ট নিজে ট্রান্সফার করতে পারবে না। অ্যাডমিনের বর্তমান "Main → Secondary" কনভার্ট অপশনই থাকবে। Secondary → Main ফেরানোর কোনো ব্যবস্থা যোগ হচ্ছে না।

**৪) হিসাব ও ইতিহাস**
- প্রতিটি অটো কনভার্শনে দুটি লাইন উঠবে: Main-এ "Converted to Secondary (৳১২০ → ৳১৩০)" এবং Secondary-তে "Received from Main"। এরপর টপ-আপের কাটাটা আলাদা লাইনে।
- ৳ হিসাবে মোট ব্যালেন্স (Wallet পেজের totals) আগের মতোই ঠিক থাকবে, কারণ কনভার্শনে ৳ মান অপরিবর্তিত।

## প্রযুক্তিগত অংশ

- নতুন SECURITY DEFINER ফাংশন `ensure_secondary_funds(p_user_id, p_needed_usd, p_processed_by, p_allow_negative, p_due_limit)`:
  - `profiles.usd_rate` / `secondary_usd_rate` (fallback `site_settings.usd_rate`) থেকে রেট নেয়।
  - ঘাটতি = needed − secondary_balance; কনভার্ট = ঘাটতি × sec_rate ÷ main_rate।
  - `p_allow_negative=false` হলে Main balance + due limit চেক করে, না হলে `{ok:false, error:'insufficient_balance'}`।
  - দুই ওয়ালেটে একবারেই balance লিখবে, দুটি `transactions` row (wallet_kind primary/secondary, usd_rate_used) রাখবে — বিদ্যমান ledger integrity trigger মেনে।
- `request_external_topup` (wallet_kind = 'secondary') → wallet deduct করার আগে `ensure_secondary_funds(..., p_allow_negative := false, p_due_limit := profiles.due_limit)` ডাকবে; ব্যর্থ হলে বর্তমান `insufficient_balance` error-ই ফেরত যাবে।
- `reject_external_topup`-এর refund আগের মতোই Secondary-তেই ফেরত যাবে (কনভার্শন উল্টানো হবে না)।
- অ্যাডমিন পথ: `ExternalTopUpDialog` এবং secondary wallet ব্যবহার করা অন্যান্য অ্যাডমিন deduction → `ensure_secondary_funds(..., p_allow_negative := true)` তারপর `adjust_wallet_atomic`।
- `spend-cap-update` edge function-এ `wallet_kind='secondary'` পথেও একই ফাংশন যোগ হবে (ক্লায়েন্ট হলে negative নয়, অ্যাডমিন হলে negative allowed)।
- ফ্রন্টএন্ড: `useWallets` থেকে দুই রেট নিয়ে `ClientAdAccounts` টপ-আপ ডায়ালগে available/convert preview দেখানো হবে; কোনো নতুন পেজ লাগবে না।
