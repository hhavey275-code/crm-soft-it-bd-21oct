
# Site Review — 5–10 বছরের জন্য Maintain করার প্ল্যান

আমি পুরো codebase, Supabase config, RLS, edge functions, security scan, এবং linter — সব দেখে নিচের অবস্থা পেয়েছি। সংক্ষেপে: **architecture মোটামুটি ঠিক আছে, কিন্তু কয়েকটা গুরুত্বপূর্ণ security হোল আছে যেগুলো এখনই বন্ধ করা দরকার**, আর কিছু long-term hygiene দরকার যাতে data drift না হয়।

---

## 🔴 Critical Security Issues (এখনই fix করতে হবে)

1. **`payment-proofs` bucket public** — যে কেউ (login ছাড়াও) সব bank receipt download করতে পারে। URL জানলেই হবে।
   → Bucket private করতে হবে, signed URL দিয়ে serve করতে হবে।

2. **`system_logs` — সব authenticated user spend cap log দেখতে পারে** (অন্য client এরও)। 
   → Policy টা `user_id = auth.uid()` দিয়ে scope করতে হবে।

3. **`agencies` table — anonymous user `subscription_fee`, `usd_rate`, `owner_id` পড়তে পারে**। 
   → শুধু branding columns (name, logo, color, slug) এর জন্য view বানিয়ে সেটা public করতে হবে, base table restrict।

4. **`profiles.meta_user_token` agency owners পড়তে পারে** — Meta API token leak হওয়ার risk। 
   → Token columns আলাদা table এ সরাতে হবে, অথবা view দিয়ে hide করতে হবে।

5. **`internal_job_secrets` — plaintext secrets DB তে আছে**। 
   → Supabase Vault অথবা edge function secrets এ সরানো উচিত।

6. **Trigger functions এ service role JWT hardcoded** (`trigger_telegram_poll_on_topup`, `sync_seller_transaction_for_approved_topup` ইত্যাদি — DB function এ anon key bearer hardcoded)। JWT rotate করলে সব trigger ভাঙবে; আবার DB dump leak হলে token leak। 
   → `vault.secrets` থেকে read করা, অথবা `pg_net` কে header থেকে dynamic key নিতে হবে।

7. **Realtime channel authorization নেই** — যেকোনো logged-in user যেকোনো channel subscribe করতে পারে (wallets, chat_messages সহ)।
   → `realtime.messages` এ RLS policy দিতে হবে।

8. **53 টা Supabase linter warning** — অনেক `SECURITY DEFINER` function anon role থেকে executable। যেগুলো public হওয়ার কথা না, সেগুলো `REVOKE EXECUTE FROM anon, authenticated` করতে হবে।

---

## 🟡 Data Integrity (Wallet/Balance যেন drift না করে)

Long-run এ সবচেয়ে বড় রিস্ক — wallet balance আর seller ledger mismatch। এখন যা দেখলাম:

- **Wallet balance কোথাও cached column হিসেবে নেই** (good) — transactions table থেকে calculate হয়। এটা ঠিক রাখতে হবে।
- **Duplicate top-up credit prevention আছে** (`prevent_duplicate_topup_credit`) — ভালো।
- **Forward slot claim/release locking আছে** — race condition থেকে protect করছে।

যা যোগ করতে হবে:

a. **Daily reconciliation job** (`pg_cron`): প্রতিদিন রাতে wallet balance vs sum(transactions) মিলিয়ে দেখবে, mismatch হলে admin কে notification পাঠাবে।

b. **Seller ledger integrity check**: প্রতি seller এর জন্য `sum(usdt_in) - sum(usdt_out)`, `sum(bdt_in) - sum(bdt_out)` calculate করে snapshot table এ রাখবে। কোনো historical row edit হলে diff ধরা পড়বে।

c. **Audit log table** (immutable, append-only): wallet, seller_transactions, top_up_requests এ যেকোনো UPDATE/DELETE log হবে (trigger দিয়ে)। কে, কখন, কী change করল।

d. **`UPDATE`/`DELETE` restriction**: approved seller_transaction আর top_up_request এ admin ছাড়া কেউ edit/delete করতে পারবে না — RLS দিয়ে enforce।

e. **Foreign key + `ON DELETE RESTRICT`**: wallet, transactions, seller_transactions এর FK গুলোতে CASCADE না দিয়ে RESTRICT রাখতে হবে — যাতে accidental cascade delete না হয়।

f. **Numeric precision lock**: BDT/USDT amount সব column যেন `numeric(18,4)` হয়, float না।

---

## 🟢 Long-term Maintenance Hygiene

1. **Migration discipline**: 30+ migrations গত 3 দিনে তৈরি হয়েছে। প্রতি change এর জন্য একটা migration, সেগুলো review করে commit করার practice রাখতে হবে। Migration কখনো edit/delete করা যাবে না।

2. **Database backup**: Supabase এ daily PITR (Point-in-Time Recovery) on করতে হবে (paid plan)। Free এ daily snapshot manually export করতে হবে।

3. **Edge function versioning**: 25+ edge functions আছে। প্রতিটা function এ version comment, error logging (Sentry/Logtail) যোগ করা উচিত।

4. **Secret rotation schedule**: 6 মাস পর পর — Telegram bot token, Meta tokens, Supabase service role key rotate। এখন hardcoded থাকায় rotate করা কঠিন — সেটা vault এ সরাতে হবে।

5. **Type drift**: `src/integrations/supabase/types.ts` auto-generated — ঠিক আছে। কিন্তু custom types component এ scattered। একটা `src/types/` folder এ centralize করা ভালো।

6. **Test coverage**: এখন কোনো automated test নেই। অন্তত critical edge functions (verify-topup, forward-proof, sync-seller-to-sheet) এর জন্য Deno test লিখতে হবে।

7. **Monitoring**: Uptime monitor (UptimeRobot), edge function error rate alert, DB slow query log review monthly।

8. **Tenant isolation**: এই project tenant mode support করে। প্রতি tenant এর data leak prevention এর জন্য আলাদা RLS test দরকার।

---

## 🛠️ Proposed Action Plan (priority order)

### Phase 1 — Security hotfix (1 sitting)
- [ ] `payment-proofs` bucket private + signed URL helper
- [ ] `system_logs` RLS policy fix
- [ ] `agencies` public view + restrict base table
- [ ] `profiles.meta_user_token` কে `user_meta_tokens` আলাদা table এ সরানো
- [ ] `internal_job_secrets` → Vault এ সরানো
- [ ] Trigger functions থেকে hardcoded JWT সরিয়ে Vault থেকে read
- [ ] `realtime.messages` RLS policy
- [ ] SECURITY DEFINER functions থেকে anon EXECUTE revoke

### Phase 2 — Data integrity (পরবর্তী session)
- [ ] Audit log table + triggers
- [ ] Daily reconciliation pg_cron job
- [ ] Approved row update/delete restriction
- [ ] Numeric precision audit

### Phase 3 — Long-term ops (চলমান)
- [ ] PITR backup enable
- [ ] Test coverage critical functions
- [ ] Monitoring + alerting setup
- [ ] Secret rotation runbook

---

## আমার সুপারিশ

**Phase 1 আজই শুরু করি** — এগুলো সব security holes, leak হলে financial/legal damage হবে। Phase 1 approve করলে আমি এক এক করে migration তৈরি করব।

কোনটা থেকে শুরু করতে চাও?
- (a) পুরো Phase 1 একসাথে (সব security fix)
- (b) সবচেয়ে urgent 3টা (payment-proofs + system_logs + agencies)
- (c) আগে আরো detail দেখাও কোন data এ এখন leak হচ্ছে
