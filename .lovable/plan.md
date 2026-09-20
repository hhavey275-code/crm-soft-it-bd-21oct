# Wallet row layout update

## কী বদলাবে
- Client Dashboard-এর প্রথম সারিতে Main, Secondary, Credit Line এবং Combined Due/Advance—এই চারটি summary পাশাপাশি থাকবে।
- Desktop-এ চারটি এক সারিতে থাকবে; tablet/mobile-এ জায়গা অনুযায়ী ২ বা ১ কলামে নামবে।
- Wallet row-এর পরে Ad Accounts, Remaining, Spend, Orders ও অন্যান্য বর্তমান summary থাকবে।
- Client-এর Add Account পাতা/segment-এও একই wallet order ও Combined Due/Advance summary যোগ হবে; account list ও button logic অপরিবর্তিত থাকবে।
- Admin যখন Client Detail-এর Overview দেখবে, সেখানেও wallet চারটি আলাদা প্রথম row-তে থাকবে এবং account statistics পরের row-তে থাকবে।
- Secondary বা Credit Line বন্ধ থাকলে সংশ্লিষ্ট card লুকানো থাকবে এবং grid অবশিষ্ট card অনুযায়ী ঠিক হবে।

## যাচাই
- Desktop ও mobile viewport-এ তিনটি জায়গার wallet card order, wrapping এবং overflow পরীক্ষা।
- Existing Add Account ও External CRM button behavior অপরিবর্তিত আছে কি না যাচাই।
- Type check এবং preview rendering যাচাই।
