# CRM Helper v2.00 ও automatic limit update

## কী বদলাবে
- Helper-এর manifest, popup, download button, filename ও package—সব জায়গায় version `2.00` দেখাবে (Chrome manifest-এ বৈধ version `2.0.0`)।
- নতুন ZIP cleanভাবে rebuild ও verify করা হবে; ZIP-এর ভেতরে extension files সরাসরি থাকবে।
- Chrome/Mac-এর সীমাবদ্ধতা পরিষ্কার রাখা হবে: Chrome Web Store ছাড়া ZIP সরাসরি install সমর্থন করে না; ZIP extract করে folder দিয়ে Load unpacked করতে হবে।

## Helper active status
- Queue খালি থাকলেও Helper নিয়মিত server heartbeat পাঠাবে, তাই request না থাকাকে আর inactive বলা হবে না।
- Popup-এ saved token নয়, server connection যাচাই করে Active/Disconnected দেখাবে।
- token expired বা server error হলে readable কারণ দেখাবে।

## Automatic processing ও spend-cap update
- Helper claim করলেই request Pending থেকে Processing-এ যাবে, যাতে অন্য admin দ্বিতীয়বার approve না করেন।
- CRM success-এর পর Helper result server-এ নিশ্চিতভাবে পাঠাবে; server request Completed করবে এবং Meta থেকে live spend cap refresh করবে।
- Meta update একটু দেরি করলে সীমিত সময়ের মধ্যে কয়েকবার check হবে; নতুন cap পাওয়া মাত্র history auto-update হবে এবং Helper tab বন্ধ হবে।
- refresh call-এর payload/account identifier বর্তমান Meta function-এর expected format অনুযায়ী ঠিক করা হবে। Manual Done কেবল সত্যিকারের failure fallback হিসেবে থাকবে।

## যাচাই
- Helper ZIP integrity, manifest version ও filename যাচাই।
- empty queue-তেও heartbeat/Active status যাচাই।
- claim → Processing → CRM result → Completed → spend cap updated flow পরীক্ষা।
- Type check ও preview build status যাচাই।
