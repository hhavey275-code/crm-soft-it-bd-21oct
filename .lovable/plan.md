আমি current code/data check করেছি। এখন problem হওয়ার মূল কারণ: `system_limit` আর `total_used` দুইটা আলাদা হিসাব হলেও UI থেকে সরাসরি update হচ্ছে, কিছু approval stale value দিয়ে `current + amount` করছে, আর manual adjustment log-এ before/after নেই। তাই কে/কেন limit বাড়ালো বা used পাল্টালো সেটা পরিষ্কার না, এবং stale overwrite/double action হলে calculation নড়াচড়া করতে পারে।

Current live data example:
- Tenant `scale up`: System Limit `$7008.12`, Used `$6812.39`, Remaining `$195.73`
- Recent approved manual limit changes আছে: `+183.24`, `+36.75`, `+36.75`, `-36.75`
- এগুলো `tenant_payments` table-এ `manual_adjustment` হিসেবে আছে, কিন্তু `reviewed_by`/before-after snapshot নেই, তাই UI-তে automatic মনে হচ্ছে।
- Usage audit এ net usage আছে: report `$1373.39`, refund `$834.68`, net `$538.71`, কিন্তু পুরোনো কিছু log-এর before/after null ছিল।

Proposed fixed rule:
```text
System Limit = Master admin approved/adjusted capacity
Used Limit   = Tenant ad-account top-up consumption only
Remaining    = System Limit - Used Limit
```

Important separation:
- Tenant payment approved হলে: only `system_limit` বাড়বে। `total_used` touch করবে না।
- Tenant ad account top-up successful হলে: only `total_used` বাড়বে। `system_limit` touch করবে না।
- Limit decrease/manual correction হলে: only `system_limit` কমবে/সেট হবে।
- Usage refund/correction হলে: `total_used` কমবে, যাতে remaining বাড়ে।
- Direct edit form থেকে `total_used`/`system_limit` free edit বন্ধ বা locked করা হবে; সব পরিবর্তন audited action দিয়ে হবে।

Implementation plan:

1. Add one authoritative ledger for all tenant limit movements
   - Create/extend a `tenant_limit_ledger` style table (or equivalent migration) with:
     - tenant_id
     - movement_type: `limit_purchase`, `limit_manual_increase`, `limit_manual_decrease`, `limit_set`, `usage_topup`, `usage_refund`, `usage_reconcile`
     - amount_delta
     - system_limit_before / system_limit_after
     - total_used_before / total_used_after
     - remaining_before / remaining_after
     - reason
     - source record id/payment id/idempotency key
     - actor/admin id where available
     - created_at
   - This will be the Master admin “truth log”: every increase/decrease/top-up/refund step-by-step.

2. Move all calculation into database RPC functions
   - Replace frontend math like `newLimit = tenant.system_limit + amount` with atomic DB functions using row lock.
   - Add functions such as:
     - `approve_tenant_limit_payment(payment_id, admin_id)`
     - `adjust_tenant_system_limit(tenant_id, mode, amount, reason, admin_id)`
     - update `apply_tenant_usage(...)` to also write the unified ledger
   - Each function will lock the tenant row, calculate before/after, update exactly one field as intended, and insert the ledger row in the same transaction.
   - This prevents stale UI values, duplicate approval races, and hidden/automatic changes.

3. Fix tenant payment approval flow
   - In `AdminTopUp.tsx`, stop directly updating `tenants.system_limit` in the frontend.
   - When a tenant payment is approved, call the new RPC.
   - Keep the existing pending guard, but let the RPC do the final atomic approval + limit increase + log.
   - If already processed, it returns a clean message instead of recalculating again.

4. Fix manual adjust flow in Tenant Detail
   - “Adjust Limit” will no longer directly update `tenants` and insert a partial `tenant_payments` row.
   - It will call the new DB function and save before/after snapshots.
   - Add clear adjustment types:
     - Increase system limit
     - Decrease system limit
     - Set exact system limit
     - Refund/correct used amount (reduces `total_used`)
   - This matches your requirement that Master admin controls all increase/decrease, but logs exactly why it changed.

5. Lock dangerous free-edit fields
   - In the Edit Tenant dialog, remove or disable direct editing of `total_used` and `system_limit`.
   - Admin must use the audited Adjust/Refund controls instead.
   - This is to stop accidental “Used Limit उल্টাপাল্টা” changes.

6. Update Usage Log UI in Master
   - Top cards:
     - Total Limit
     - Used Limit
     - Remaining
   - Below: unified transaction cards/table showing exactly:
     - What happened: payment approved / ad-account top-up / refund / manual adjustment
     - Before limit, delta, after limit
     - Before used, delta, after used
     - Before remaining, after remaining
     - Reason/source/account/payment/admin/time
   - This will show “কত limit ছিল, কত নিলো, কত remaining থাকলো” for every step.

7. Update Tenant-side display
   - Tenant System Top-Up and Usage Log will keep showing cached heartbeat values.
   - After payment/top-up, force heartbeat/refetch so tenant sees fresh Master values.
   - Tenant cannot locally change limit; it only reads Master-approved limit.

8. Optional one-time data repair after code fix
   - Current old rows have incomplete before/after in some places.
   - I will prepare a safe reconciliation query/report for current tenants showing:
     - current `system_limit`
     - current `total_used`
     - approved limit changes
     - usage logs
     - suspicious duplicate/manual adjustment rows
   - I will not automatically rewrite historical money values unless you approve the exact correction.

Expected result after this:
- Payment approve => Limit increases once, accurately logged.
- Ad account top-up => Used increases once, accurately logged.
- Limit reached => tenant top-up blocked.
- New system top-up approve => tenant can top-up again.
- Refund/manual correction => Master admin action only, with exact reason and before/after.
- No more hidden automatic-looking limit changes from partial logs or stale frontend calculations.