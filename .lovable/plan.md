# Tenant Payment → Seller Ledger + Telegram Total Fix

## সমস্যা যা পেলাম

1. **Tenant payment approve হলে seller ledger এ entry যাচ্ছে না** — `AdminTopUp.tsx` এ tenant payment branch (line 280-323) শুধু `tenants` table update করে আর system log লেখে। `seller_transactions` এ insert নাই, `forward-proof`/`forward-seller-proof` ও call হয় না। ফলে seller এর "shit" (ledger sheet) এ payment count হচ্ছে না।
2. **Telegram এ Total amount missing** — Tenant proof forward হয় শুধু **submit** এর সময় (`tenant-webhook` line 397-559) — সেখানে seller এর running total/Due-Advance line নাই। Approve এর সময় আবার কোনো forward-ই হয় না।
3. **Bank এ seller assigned না থাকলে কিছুই হবে না** — DB তে অনেক approved tenant payment `city bank` এ আছে যেটার `seller_id = NULL`। Seller assigned না হলে ledger entry impossible।
4. **Historical backfill দরকার** — এখন পর্যন্ত যে ২টা approved tenant payment seller-assigned bank এ আছে (Dutch Bangla Bank, seller `e5670168...`), সেগুলা ledger এ insert করা দরকার (Tk 25,600 + Tk 12,800 = Tk 38,400)।

## যা পরিবর্তন হবে

### ১) Database migration

- `seller_transactions` table এ নতুন column: `tenant_payment_id uuid` (nullable, FK → `tenant_payments.id` ON DELETE SET NULL)
- Unique partial index: `(tenant_payment_id) WHERE tenant_payment_id IS NOT NULL` — same tenant payment দুইবার ledger এ insert আটকাবে (idempotency)
- `seller_transactions.type` এ existing values এর পাশাপাশি `'tenant_payment'` value allow করতে check constraint relax (যদি থাকে); description field দিয়ে differentiate

### ২) `AdminTopUp.tsx` — tenant approve flow এ যোগ করা হবে

Approve সফল হওয়ার পর:

- যদি `bank_account_id` থাকে এবং সেই bank এর `seller_id` থাকে → `seller_transactions` এ এই row insert:
  - `type: 'tenant_payment'` (নতুন type, "+bdt" treat হবে — Advance বাড়াবে)
  - `bdt_amount: tp.amount`
  - `tenant_payment_id: tp.id`
  - `bank_account_id`, `proof_url`, `reviewed_by`, `entry_by_name = "Tenant: <name>"`
  - `status: 'approved'`
- এর পরে `forward-seller-proof` call করা হবে যাতে Telegram group এ Total সহ approved notification যায়
- যদি bank এ seller না থাকে → silently skip + console warning (existing behavior)

### ৩) `forward-proof` ও `forward-seller-proof` — `tenant_payment` type recognize

দুই function এর `computeDueAdvance()` এ `tenant_payment` কে `bdt_payment` এর মতো +bdt treat করবে। এতে seller এর running Total সঠিক হবে।

### ৪) `tenant-webhook` submit forward — Total line যোগ

Tenant payment submit এর সময় যে Telegram caption যায় সেখানে seller (যদি bank assigned থাকে) এর current Due/Advance Total line দেখানো হবে। Approve হওয়ার পরের forward এ updated Total দেখাবে।

### ৫) Historical Backfill (one-time script run)

Approved tenant payments যেগুলার bank এ seller assigned আছে কিন্তু `seller_transactions` এ এখনো entry নাই — সেগুলা insert করা হবে। আজকে এমন ২টা পেমেন্ট আছে (Tk 38,400 মোট, seller `e5670168...`)। Future এ যদি নতুন কোনো বের হয় সেগুলাও cover হবে।

## টেকনিক্যাল ডিটেইল

```sql
ALTER TABLE seller_transactions
  ADD COLUMN tenant_payment_id uuid REFERENCES tenant_payments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX seller_transactions_tenant_payment_unique 
  ON seller_transactions (tenant_payment_id) 
  WHERE tenant_payment_id IS NOT NULL;
```

`forward-proof` & `forward-seller-proof` এর `computeDueAdvance`:

```ts
if (t.type === 'bdt_payment' || t.type === 'client_topup' || t.type === 'tenant_payment') {
  running += Number(t.bdt_amount || 0);
}
```

`AdminTopUp.tsx` tenant approve এর শেষে:

```ts
if (action === "approved" && requestRow.bank_account_id) {
  const { data: bank } = await supabase.from("bank_accounts")
    .select("seller_id").eq("id", requestRow.bank_account_id).single();
  if (bank?.seller_id) {
    await supabase.from("seller_transactions").insert({
      seller_id: bank.seller_id,
      type: "tenant_payment",
      bdt_amount: Number(requestRow._original_amount || 0),
      tenant_payment_id: id,
      bank_account_id: requestRow.bank_account_id,
      proof_url: requestRow.proof_url,
      status: "approved",
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      entry_by_name: `Tenant: ${tenant?.name || "Unknown"}`,
      description: `Tenant payment approved — ${requestRow._payment_type}`,
    });
    await supabase.functions.invoke("forward-seller-proof", { body: { ... } });
  }
}
```

## ইম্প্যাক্ট

- নতুন approve: ledger automatic + Telegram Total সহ ✅
- Past 2 payment (Tk 38,400) ledger এ চলে আসবে → seller balance সঠিক
- Bank এ seller না থাকলে warning দেবে, যাতে আপনি seller assign করতে পারেন, সব ব্যাংক সেলার এর নয়,আমাদের ব্যাংক ও আছে যেগুলা তে ফরওয়াররড দরকার হবে না.যে ব্যাংক গুলাতে সেলার এসাইন আছে সেগুলা এন্ট্রি দিলেই হবে.
- Duplicate insert impossible (unique index)

## আপনার approve পেলে আমি migration লিখব → তারপর code changes → তারপর backfill script চালাব। তিনটাই sequentially।