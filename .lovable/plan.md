আমি কোড/ডাটাবেস দেখে যেটা পেলাম:

- `scale up` tenant-এর master row এখন:
  - `system_limit = $6,788.13`
  - `total_used = $6,473.68`
- আপনার screenshot অনুযায়ী tenant-side actual log:
  - `total_used = $5,639.00`
  - তাই master বেশি দেখাচ্ছে `6473.68 - 5639 = $834.68`।
- আগে একবার master `total_used` manually align করা হয়েছিল `$4,898.50` এ, কিন্তু এরপর আবার drift হয়েছে।
- সবচেয়ে বড় সমস্যা: tenant usage update হচ্ছে `tenant-webhook` এর `report-usage` action দিয়ে, কিন্তু master-side audit/dedup table `tenant_usage_report_keys` খালি। মানে usage বাড়ার হিসাবের stable audit trail নেই / deployed function পুরোনো logic চালাতে পারে / logging insert fail করছে। তাই কোন top-up master-used বাড়ালো সেটা পরিষ্কার দেখা যাচ্ছে না।
- আরেকটা ঝুঁকি আছে: tenant-side `spend-cap-update` idempotency key এখন minute-based:
  `topup:{ad_account_id}:{amount}:{minute}`
  এটা retry কিছুটা আটকায়, কিন্তু production accounting-এর জন্য যথেষ্ট শক্ত না। একই logical request-এর permanent id থাকা দরকার।

Plan to fix:

1. Correct current bad value for Scale Up
   - Master `tenants.total_used` for `scale up` tenant set করব `$5,639.00`।
   - একই সঙ্গে tenant-এর local `site_settings.license_total_used` heartbeat/response থেকে sync হবে, যাতে UI-তে master/tenant এক থাকে।

2. Add proper audit table for every system usage movement
   - `tenant_usage_report_keys` শুধু dedupe key না রেখে useful audit বানাব:
     - tenant_id
     - action: `report-usage` / `refund-usage` / adjustment
     - amount
     - idempotency_key
     - source/ad_account/payment/failed_topup reference if available
     - before_total_used
     - after_total_used
     - created_at
   - এতে ভবিষ্যতে exact দেখা যাবে master used কেন বাড়ল/কমল।

3. Make master usage updates atomic and idempotent
   - `tenant-webhook` এর `report-usage` / `refund-usage` logic update করব যেন:
     - duplicate key হলে আর count না করে current total return করে।
     - concurrent request এ double count না হয়।
     - usage row + tenant total update এক reliable flow-তে হয়।
   - Current edge function redeploy করব, কারণ deployed side-এ audit key লিখছে না বলে মনে হচ্ছে।

4. Fix tenant-side usage reporting key
   - `spend-cap-update` থেকে minute-based key বাদ দিয়ে stable key ব্যবহার করব।
   - Best source:
     - wallet transaction id / request id / failed_topup id / ad_account + exact created transaction id
   - Retry করলে same key যাবে; new top-up হলে new key যাবে।

5. Fix retry/refund edge cases
   - `retry-failed-topup` already reports usage on successful retry, কিন্তু key/audit আরও clear করব।
   - `resolve-failed-topup` refund currently no idempotency key পাঠায়; এটাও fix করব, না হলে repeated refund/report drift করতে পারে।

6. Add master-side reconciliation button/report
   - Tenant detail page-এ একটি small “Reconcile Used” action/report যোগ করব:
     - master total_used
     - tenant reported/current total_used
     - difference
     - last N usage audit rows
   - ভবিষ্যতে mismatch হলে manually guess না করে এক ক্লিকে align করা যাবে।

7. Deploy and verify
   - `tenant-webhook`, `spend-cap-update`, `retry-failed-topup`, `resolve-failed-topup` deploy করব।
   - DB migration দিয়ে current Scale Up value `$5,639.00` করব এবং audit baseline row রাখব: “manual correction from $6,473.68 to $5,639.00”.

Expected result:

- Scale Up master used immediately `$5,639.00` দেখাবে।
- Future client top-up করলে master used ঠিক amount-ই বাড়বে।
- Failed top-up retry/refund double count করবে না।
- কোন tenant কত used হওয়ার কথা, কত হয়েছে—এটার audit trail থাকবে।