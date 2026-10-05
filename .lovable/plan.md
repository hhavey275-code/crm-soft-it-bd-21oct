# Profile Stock (Two-line / Facebook profile বিক্রি)

## কী পাবেন
**Admin — "Profile Stock" পেজ (বাম মেনুতে)**
- একটা ফর্মে একটা করে profile যোগ: User ID/Username, Password, Email, Email password, Email login link, 2FA key, নোট।
- উপরে একটা "দাম (USD)" ঘর — সব profile এই এক দামে বিক্রি হবে।
- তালিকায় প্রতিটা profile-এর অবস্থা: **Available / Used / Purchased**।
- "Used" বাটন — নিজেরা ব্যবহার করলে চাপবেন, তখন আর কেউ কিনতে পারবে না (চাইলে আবার Available করা যাবে)।
- Purchased হলে কোন client কিনেছে ও কবে — দেখা যাবে।
- উপরে গণনা: কয়টা available, used, purchased। ফিল্টার ও সার্চ।

**Client — "Buy Profile" পেজ**
- কয়টা stock আছে আর দাম কত দেখাবে (profile-এর তথ্য দেখাবে না)।
- কয়টা কিনবে সংখ্যা বেছে "Buy" — Main wallet থেকে টাকা কাটবে। balance কম বা stock কম হলে কেনা যাবে না, কারণ দেখাবে।
- কেনার সাথে সাথে "My Profiles"-এ ID, password, email, email password, link, 2FA key দেখাবে (copy বাটনসহ)।
- Wallet transaction-এ "Profile purchase × N" হিসেবে লেখা থাকবে।

## নিরাপত্তা
- Available profile-এর তথ্য client কখনও দেখতে পারবে না — শুধু নিজের কেনা গুলো।
- দুইজন একসাথে কিনলেও একই profile দুইজন পাবে না; টাকা কাটা ও profile বরাদ্দ একসাথে হবে — একটা ব্যর্থ হলে কোনোটাই হবে না।

## Technical details
- Migration: `facebook_profiles` টেবিল (uid, password, email, email_password, email_link, two_fa_key, note, status `available|used|purchased`, purchased_by, purchased_at, price_paid, timestamps) + GRANT + RLS: admin/superadmin সব; client শুধু `purchased_by = auth.uid()` পড়তে পারবে।
- দাম `site_settings` key `profile_price_usd`।
- `purchase_profiles(p_qty int)` security definer RPC: `FOR UPDATE SKIP LOCKED` দিয়ে available row লক, পর্যাপ্ত না হলে error, main wallet থেকে `adjust_wallet_atomic` (allow_negative false) দিয়ে কাটা, row গুলো purchased করে ফেরত। `get_profile_stock()` RPC — শুধু available সংখ্যা ও দাম।
- Admin পেজ `src/routes/profile-stock.tsx`, client পেজ `src/routes/buy-profile.tsx`, `AppSidebar.tsx`-এ মেনু লিংক (role অনুযায়ী)।

## সীমা
- Password গুলো ডেটাবেসে সাধারণ লেখা হিসেবে থাকবে (শুধু admin ও ক্রেতা দেখতে পারবে)।
- `app.softitbd.com`-এ দেখাতে Vercel-এ আবার deploy লাগবে।
