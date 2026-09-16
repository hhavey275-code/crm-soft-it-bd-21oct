# Internal API Top-Up Concurrency Protection

## Confirmed current behavior

- Client-এর **Main Wallet $100** এবং available due limit $0 হলে, PC ও mobile থেকে একই সময়ে দুই ad account-এ $100 করে **Top Up Now** চাপলেও $200 top-up হবে না।
- Wallet deduction database row lock (`FOR UPDATE`) ব্যবহার করে। প্রথম request $100 কাটার পর দ্বিতীয় request updated $0 balance দেখবে এবং **Insufficient wallet balance** দিয়ে বন্ধ হবে।
- একই ad account ও একই amount-এর accidental repeat-এর জন্য আলাদা 60-second duplicate guard-ও আছে।
- Client-এর due limit থাকলে দ্বিতীয় request সেই অনুমোদিত due limit পর্যন্ত চলতে পারে; এটি duplicate spending নয়, configured credit সুবিধা।

## Hardening work

1. Main ও Secondary—দুই ধরনের internal API top-up একই client-এর জন্য একক database lock-এর অধীনে আনা।
2. Secondary wallet-এ Main balance auto-conversion এবং final deduction একই serialized flow-তে রাখা, যাতে cross-wallet simultaneous request-ও stale balance ব্যবহার না করে।
3. Client-এর wallet + তার নিজস্ব due limit-এর বাইরে balance negative হতে না দেওয়া; admin-এর existing negative-balance permission অপরিবর্তিত রাখা।
4. দুই concurrent $100 request বনাম $100 balance scenario দিয়ে database-level verification করা—একটি সফল, অন্যটি insufficient নিশ্চিত করা।

## Scope

- শুধু আমাদের CRM-এর API-driven **Top Up Now** flow।
- External CRM top-up flow বা UI পরিবর্তন হবে না।
