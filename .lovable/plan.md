# External CRM limit recovery সহজ করা

## কী হবে
- CRM helper সফল বলার পর Meta limit না বাড়লে **২ মিনিট অপেক্ষা করে** আবার Meta থেকে live limit check হবে।
- তখনও limit না বাড়লে request-টি **শুধু একবার** office helper-এর retry queue-তে যাবে; wallet থেকে আর টাকা কাটা হবে না।
- Retry-এর আগে এবং retry চালুর ঠিক আগেও Meta check হবে। Limit ইতিমধ্যে বাড়লে retry বাতিল করে history-তে old → new limitসহ Completed দেখাবে।

## Admin flow
- `Manually done` চাপলে প্রথমে Meta থেকে live limit check হবে।
- Limit বাড়লে সঙ্গে সঙ্গে Completed (Admin) হবে।
- Limit না বাড়লে একই click-এ CRM helper খুলে একবার retry করবে; আলাদা করে manual top-up দিতে হবে না।
- Busy/retrying state দেখাবে এবং একই request দ্বিতীয়বার চালু করা যাবে না।

## Client flow
- Transaction History-তে `Limit বাড়েনি`-র পাশে ছোট **Update** button থাকবে।
- Update চাপলে প্রথমে Meta live check হবে।
- Limit বাড়লে সঙ্গে সঙ্গে history ঠিক হবে; না বাড়লে office helper-এ একবার retry queue হবে এবং client `Retry queued` দেখবে।
- Client CRM link/token পাবে না এবং wallet আবার charge হবে না।

## নিরাপত্তা ও ভুল top-up প্রতিরোধ
- নতুন retry count/status/time database-এ রাখা হবে; একই request সর্বোচ্চ একবার retry করা যাবে।
- Client শুধু নিজের request retry করতে পারবে; admin সব request করতে পারবে।
- Claim atomic থাকবে, তাই office PC ও admin একই সময় click করলেও একবারই চলবে।
- Retry ব্যর্থ হলে আর automatic loop হবে না; admin-কে error দেখাবে।

## Technical details
- `external_topup_requests`-এ retry tracking columns এবং authenticated retry RPC/server function যোগ হবে।
- `/api/public/crm-topup`-এর list/claim/result flow completed-but-unupdated retry jobs support করবে এবং claim-এর আগে Meta refresh করবে।
- Existing `autopilot_pings` wake-up ব্যবহার করে client/admin queued retry দ্রুত helper-এ পাঠানো হবে; স্থায়ী database polling job যোগ হবে না।
- `AdminExternalTopUpRequests` এবং `TransactionHistoryPanel`-এ retry controls/status যোগ হবে; extension package version bump করে ZIP rebuild হবে।
