# External CRM Top-Up Request (ক্লায়েন্ট → অ্যাডমিন)

গ্রুপে মেসেজ দেওয়ার দরকার শেষ। যে অ্যাড অ্যাকাউন্টে আমাদের API নেই (External CRM লিংক বসানো), সেখানে ক্লায়েন্ট নিজেই টপ-আপ রিকোয়েস্ট দেবে, টাকা সাথে সাথে ওয়ালেট থেকে কাটা হবে, আর রিকোয়েস্টটা অ্যাডমিন ড্যাশবোর্ডে জমা থাকবে। অ্যাডমিন এক ক্লিকে CRM লিংকে গিয়ে টপ-আপ করে দেবে।

## ক্লায়েন্টের দিক

- অ্যাড অ্যাকাউন্ট লিস্টে টপ-আপ বোতাম দেখানোর নিয়ম হবে লিংক অনুযায়ী:
  - মেইন লিংক বসানো থাকলে → মেইন ওয়ালেট বোতাম দেখাবে, এবং সেটা রিকোয়েস্ট পাঠাবে।
  - শুধু সেকেন্ডারি লিংক বসানো থাকলে → মেইন ওয়ালেট বোতাম দেখাবে না, শুধু সেকেন্ডারি বোতাম থাকবে।
  - যে বোতামের পেছনে লিংক নেই, সেই বোতাম External অ্যাকাউন্টে দেখাবে না।
- অ্যামাউন্ট লিখে "Send Top-Up Request" দিলে:
  - ব্যালেন্স চেক: মেইনের মতো সেকেন্ডারি ওয়ালেটেও এখন due limit কাজ করবে — ব্যালেন্স + due limit পর্যন্ত রিকোয়েস্ট দিতে পারবে, তার বেশি হলে "Insufficient fund"।
  - টাকা সাথে সাথেই নির্দিষ্ট ওয়ালেট থেকে কাটা হবে এবং ট্রানজেকশন হিস্ট্রিতে উঠবে।
  - রিকোয়েস্ট স্ট্যাটাস "Pending" হবে; ক্লায়েন্ট নিজের রিকোয়েস্টগুলোর স্ট্যাটাস দেখতে পাবে।

## অ্যাডমিনের দিক

- Requests পেজে নতুন ট্যাব: **External Top-Up** (pending সংখ্যা ব্যাজ সহ)।
- প্রতিটি সারিতে: ক্লায়েন্টের নাম, অ্যাড অ্যাকাউন্ট নাম + ID, অ্যামাউন্ট, কোন ওয়ালেট, CRM নাম, সময়।
- **Open CRM & Complete** বোতাম: চাপলেই অ্যাকাউন্ট ID + অ্যামাউন্ট ক্লিপবোর্ডে কপি হবে, ওই অ্যাকাউন্টের CRM লিংক নতুন ট্যাবে খুলবে, আর রিকোয়েস্ট সাথে সাথে **completed** হয়ে যাবে (আপনার নির্দেশ মতো)।
- **Reject** বোতাম: কাটা টাকা অটোমেটিক ওই ওয়ালেটেই ফেরত যাবে (রিফান্ড ট্রানজেকশন সহ), স্ট্যাটাস rejected।
- সব রিকোয়েস্টের পূর্ণ হিস্ট্রি (pending / completed / rejected) ফিল্টার করে দেখা যাবে, কে সম্পন্ন করেছে তাও থাকবে।
- ক্লায়েন্ট রিকোয়েস্ট দিলে অ্যাডমিনদের নোটিফিকেশন যাবে (বেল আইকন), যাতে চোখ এড়িয়ে না যায়।

## টেকনিক্যাল বিবরণ

Database (`supabase--migration`):
- `external_topup_requests`: `status` এ `pending`/`rejected` ব্যবহার শুরু, নতুন কলাম `requested_by_client boolean default false`, `rejected_by uuid`, `rejected_at timestamptz`, `admin_note text`।
- RLS: বর্তমানে শুধু admin/superadmin ALL। যোগ হবে — ক্লায়েন্ট নিজের রিকোয়েস্ট দেখতে পারবে (`user_id = auth.uid()` SELECT) এবং নিজের নামে insert করতে পারবে শুধু pending স্ট্যাটাসে; `GRANT SELECT, INSERT ON public.external_topup_requests TO authenticated`।
- নতুন SECURITY DEFINER ফাংশন `request_external_topup(p_ad_account_id, p_amount, p_wallet_kind)`:
  - কলার আসলেই ওই অ্যাড অ্যাকাউন্টে assigned কিনা (`user_ad_accounts`) যাচাই।
  - অ্যাকাউন্টে `external_topup_required` এবং সংশ্লিষ্ট URL আছে কিনা যাচাই।
  - ওয়ালেট ব্যালেন্স + `profiles.due_limit` (উভয় ওয়ালেটের জন্য) চেক; কম হলে error।
  - `adjust_wallet_atomic(-amount, type='external_topup_request', p_wallet_kind, p_allow_negative=true)` দিয়ে কাটবে, request row insert করে ফেরত দেবে।
- `reject_external_topup(p_id, p_note)` — admin only; `adjust_wallet_atomic(+amount)` দিয়ে রিফান্ড, idempotent (একবারই রিফান্ড)।
- `complete_external_topup(p_id)` — admin only; status=completed, `completed_by/at` সেট।
- ট্রিগার: pending insert হলে admin/superadmin দের `notifications` row।

Frontend:
- `ClientAdAccounts.tsx` — external অ্যাকাউন্টের বোতাম দৃশ্যমানতা লিংক অনুযায়ী, এবং `spend-cap-update` এর বদলে `request_external_topup` কল; সেকেন্ডারি ওয়ালেটে due limit যুক্ত ব্যালেন্স চেক।
- নতুন `src/components/admin/AdminExternalTopUpRequests.tsx` — লিস্ট, Open CRM & Complete, Reject, স্ট্যাটাস ফিল্টার; `ExternalTopUpDialog` এর কপি+অ্যাঙ্কর-ক্লিক লজিক পুনঃব্যবহার।
- `AdminRequests.tsx` — নতুন ট্যাব + pending count ব্যাজ; `useSidebarBadges` এ কাউন্ট যোগ।
- ক্লায়েন্টের `ClientRequests.tsx` এ নিজের external top-up রিকোয়েস্টের স্ট্যাটাস সেকশন।
- অ্যাডমিনের বর্তমান ম্যানুয়াল External CRM Top-Up ডায়ালগ অপরিবর্তিত থাকবে।
