# Credit Line top-up history সহজ করা

## কী বদলাবে
- একই সময়ে হওয়া **Main debit → Credit Line credit → Ad Account top-up** তিনটি ledger entry-কে একটি grouped top-up event হিসেবে দেখানো হবে। ডেটাবেসের আসল তিনটি হিসাব অপরিবর্তিত থাকবে।
- মূল লাইনে থাকবে ad account, top-up amount, spend cap status এবং final Credit Line balance।
- মূল লাইনের নিচে সবসময় একটি পরিষ্কার **Payment flow** দেখা যাবে:
  1. `Main Wallet: $1,886.74 → $1,881.58 (-$5.16)`
  2. `Credit Line: $0 → $5.00 (+$5.00 converted)`
  3. `Top-up: Credit Line $5.00 → $0 (-$5.00)`
- দুই wallet-এর rate আলাদা হলে একই জায়গায় `৳128 → ৳...` conversion rate দেখাবে। তাই ক্লায়েন্ট বুঝবে Main balance কেন বদলেছে এবং ad account-এ আসলে কত top-up হয়েছে।
- Desktop table ও mobile transaction card—দুই জায়গাতেই একই grouped flow থাকবে।
- Main wallet থেকে conversion প্রয়োজন না হলে শুধু Credit Line top-up ধাপটি দেখাবে।

## হিসাব ও ফিল্টার
- Internal wallet transfer-কে আলাদা top-up/spend হিসেবে summary-তে double-count করা হবে না।
- Wallet tab বা account search ব্যবহার করলেও grouped event ভাঙবে না; সংশ্লিষ্ট top-up একটি event হিসেবেই থাকবে।
- Existing standalone manual conversions আলাদা transaction হিসেবেই থাকবে—শুধু top-up-এর সঙ্গে একই সময়ে তৈরি হওয়া automatic funding entries group হবে।

## Technical details
- বর্তমানে grouping calculation তৈরি হলেও table/mobile render raw `rows` ব্যবহার করছে; render path-এ grouped rows প্রয়োগ করা হবে।
- প্রতিটি adjustment-এর `balance_after` ও `amount` থেকে before balance নির্ণয় করে exact wallet balance transition দেখানো হবে।
- Existing transaction records, wallet balances বা top-up processing logic পরিবর্তন করা হবে না।
- পরিবর্তনের পর type-check, build status এবং desktop/mobile rendering যাচাই করা হবে।
