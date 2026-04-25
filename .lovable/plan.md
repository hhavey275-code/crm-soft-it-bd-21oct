## লক্ষ্য
Master CRM থেকে প্রতিটা tenant-এর জন্য client detail page-এর মতো full monitoring dashboard — কতটা ad account active/disabled, কত spend (today/yesterday/monthly/total), কত top-up হলো, কত limit lock হলো, কত wallet balance — সব live দেখা যাবে। Tenant site-এ আর login করতে হবে না।

---

## Architecture (যেভাবে কাজ করবে)

বর্তমান ৫-মিনিটের heartbeat (`useTenantLicense.ts` → `tenant-webhook` heartbeat action) কে extend করে দু'মুখী করা হবে:

```
Tenant site (every 5 min)
   ↓ heartbeat + stats payload
Master tenant-webhook
   ↓ store snapshot
tenant_stats_snapshots + tenants (latest cache columns)
   ↓
Master TenantDetailPage UI (client detail page-এর মতো)
```

Tenant-side বর্তমানে শুধু `{action:"heartbeat"}` পাঠায়। এর সাথে একটা `stats: {...}` object যোগ করা হবে যেটায় aggregated metrics থাকবে।

---

## Step 1 — Database (master side migration)

নতুন একটা table যেটা প্রতি heartbeat-এ একটা row insert করবে (history graph-এর জন্য):

```sql
CREATE TABLE public.tenant_stats_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  -- accounts
  accounts_total int DEFAULT 0,
  accounts_active int DEFAULT 0,
  accounts_disabled int DEFAULT 0,
  accounts_inactive int DEFAULT 0,
  -- spend ($USD aggregated across all tenant ad accounts)
  spend_today numeric DEFAULT 0,
  spend_yesterday numeric DEFAULT 0,
  spend_this_month numeric DEFAULT 0,
  spend_last_30d numeric DEFAULT 0,
  spend_lifetime numeric DEFAULT 0,
  -- orders
  orders_today int DEFAULT 0,
  orders_yesterday int DEFAULT 0,
  -- wallet / users
  total_wallet_balance numeric DEFAULT 0,
  total_clients int DEFAULT 0,
  active_clients_today int DEFAULT 0,
  -- top-up activity
  topups_today_count int DEFAULT 0,
  topups_today_amount numeric DEFAULT 0,
  topups_pending_count int DEFAULT 0,
  -- raw payload backup
  raw jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX ON public.tenant_stats_snapshots (tenant_id, snapshot_at DESC);
ALTER TABLE public.tenant_stats_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage stats snapshots" ON public.tenant_stats_snapshots
  FOR ALL TO authenticated USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'superadmin'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'superadmin'));
```

আর `tenants` table-এ "latest snapshot" cache columns (instant read-এর জন্য, history scan ছাড়া):

```sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stats_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stats_accounts_total int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_accounts_active int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_accounts_disabled int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_today numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_yesterday numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_month numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_spend_lifetime numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_orders_today int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_total_wallet numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_total_clients int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_topups_today_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_topups_pending int DEFAULT 0;
```

পাশাপাশি একটা optional detailed table যেখানে tenant তার top ad accounts list পাঠাবে (উপরের ৫০টা by spend, JSON):

```sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stats_top_accounts jsonb DEFAULT '[]'::jsonb;
-- shape: [{name, external_id, status, spend_today, spend_lifetime, balance}, ...]
```

---

## Step 2 — Master `tenant-webhook` update

`heartbeat` case-এ incoming `stats` object পেলে সেটা parse করে:
1. `tenants` row-এর `stats_*` columns update করা
2. `tenant_stats_snapshots`-এ একটা row insert করা (history)
3. Backward-compat: পুরনো tenant build যেটা stats পাঠায় না সেটাও আগের মতো কাজ করবে

```ts
case "heartbeat": {
  const stats = body.stats ?? payload?.stats ?? null;
  const updates: any = { last_heartbeat_at: new Date().toISOString() };
  if (stats && typeof stats === "object") {
    Object.assign(updates, {
      stats_updated_at: new Date().toISOString(),
      stats_accounts_total: stats.accounts_total ?? 0,
      stats_accounts_active: stats.accounts_active ?? 0,
      // ... সব fields
      stats_top_accounts: stats.top_accounts ?? [],
    });
    await supabase.from("tenant_stats_snapshots").insert({
      tenant_id: tenant.id,
      ...statsRow, raw: stats,
    });
  }
  await supabase.from("tenants").update(updates).eq("id", tenant.id);
  return json({ status, system_limit, ... });  // unchanged response
}
```

---

## Step 3 — Tenant-side patch (২ ফাইল, applied to tenant projects)

### A. New helper `src/lib/collectTenantStats.ts`
এক query call দিয়ে aggregate করবে — খুব hot path নয় (৫ মিনিটে একবার), so straightforward:

```ts
export async function collectTenantStats() {
  const today = ...todayBD; const yesterday = ...; const monthStart = ...;
  
  // 1. ad accounts বের করো — count by status
  const { data: accounts } = await supabase
    .from("ad_accounts").select("id, status");
  
  // 2. ad_account_insights থেকে today/yesterday spend+orders
  const { data: ins } = await supabase
    .from("ad_account_insights")
    .select("ad_account_id, today_spend, yesterday_spend, today_orders, yesterday_orders");
  
  // 3. transactions থেকে month-to-date এবং lifetime spend
  const { data: monthTx } = await supabase.from("transactions")
    .select("amount").eq("type","ad_topup").gte("created_at", monthStart);
  
  // 4. wallets sum
  const { data: wallets } = await supabase.from("wallets").select("balance");
  
  // 5. profiles count (clients)
  const { count: clientCount } = await supabase
    .from("profiles").select("id",{count:"exact",head:true});
  
  // 6. top_up_requests today (count+amount, pending count)
  const { data: tups } = await supabase
    .from("top_up_requests").select("amount,status,created_at")
    .gte("created_at", today);
  
  // 7. top 50 ad accounts by spend (joined with insights) → top_accounts array
  
  return { accounts_total, accounts_active, ..., top_accounts: [...] };
}
```

### B. `useTenantLicense.ts` update
Heartbeat call-এ `body: JSON.stringify({ action:"heartbeat", stats: await collectTenantStats() })`

> দুটো ফাইলের patch master message-এ tenant operator-এর জন্য copy-paste ready দেওয়া হবে যাতে প্রত্যেক tenant project-এ apply করা যায়। Backward-compat: পুরনো tenant যেটা update করেনি সেটাও আগের মতো heartbeat করতে পারবে — শুধু stats দেখা যাবে না।

---

## Step 4 — Master UI: `TenantDetailPage.tsx` upgrade

বর্তমান page-এ যা আছে (header, metric cards, payments, banks, info tabs) সব রেখে client detail page-এর pattern-এ আরো যোগ করব:

### নতুন Metric Cards (top row, 6-grid like ClientDetail)
- 📊 **Total Ad Accounts**: `42` (badge: 38 active / 4 disabled)
- 🔥 **Today Spend**: `$1,247` (subtitle: yesterday $980)
- 📅 **This Month Spend**: `$28,450`
- 💰 **Total Wallet Balance**: `$5,230` (sum of all client wallets in tenant)
- 👥 **Total Clients**: `58`
- 🛒 **Today Orders**: `124`

### নতুন Tabs (existing payments/banks/info-এর সাথে)

**1. Overview tab** (default)
- Big metric cards
- "Last sync" indicator (`stats_updated_at`-এর relative time, যেমন "3 min ago")
- Manual refresh button (force tenant heartbeat trigger না, just re-fetch master cache)
- Spend trend chart (গত ৩০ দিনের `tenant_stats_snapshots.spend_today` daily line chart — Recharts use করে)

**2. Ad Accounts tab**
- `tenant.stats_top_accounts` থেকে list (top 50 by lifetime spend)
- Columns: Name, External ID, Status badge, Today Spend, Lifetime Spend, Balance
- Search filter
- Note: শুধু top 50; full list চাইলে tenant site-এ যেতে হবে — UI-তে সেটা হালকা note থাকবে

**3. Limit Log / Transactions tab**
- existing `tenant_payments` filter করে দেখাবে: subscription payment, limit purchase, manual_adjustment আলাদা color/icon সহ
- "Used / Limit / Remaining" summary row উপরে
- Type filter (All / Limit Purchase / Manual Adjustment / Subscription)

**4. Activity tab**
- `system_logs` থেকে যেগুলো `actor_email = 'tenant:<name>'` সেগুলো দেখাবে (heartbeat, report_usage, refund_usage, submit_payment, chat_message, withdraw_request, bm_share_request)
- Timeline view, latest first

**5. Payments / Banks / Info** — existing as-is

### History pagination
`tenant_stats_snapshots` থেকে last 30/90 days-এর data nested chart-এ render হবে। Old snapshots auto-cleanup করার জন্য একটা optional ৯০ দিনের retention policy পরে যোগ করা যাবে।

---

## Step 5 — UI consistency (ClientDetailPage-এর মতো)

- একই `MetricCard` component reuse
- একই `Tabs` style + mobile-friendly horizontal scroll TabsList
- একই color palette: `bg-primary/10` icon bg, etc.
- একই date-range Popover filter সবার উপরে (period selector: Today / This Month / Custom)
- Mobile responsive — ক্লায়েন্ট ডিটেইল পেজে যেমন `isMobile` দিয়ে compact size, একই pattern

---

## Files যা পরিবর্তন/তৈরি হবে

**Master CRM (এই project):**
1. **Migration** — `tenant_stats_snapshots` table + `tenants` cache columns
2. **`supabase/functions/tenant-webhook/index.ts`** — heartbeat case-এ stats parse + insert
3. **`src/components/pages/TenantDetailPage.tsx`** — major rewrite, ClientDetailPage pattern
4. **`src/lib/router-compat.tsx`** বা TanStack — কিছু নয়, existing route যথেষ্ট

**Tenant projects (instructions দেওয়া হবে, manual apply):**
1. **`src/lib/collectTenantStats.ts`** — নতুন helper file (master message-এ full code)
2. **`src/hooks/useTenantLicense.ts`** — heartbeat body-তে stats যোগ

---

## যা bonus হিসেবে আসবে
- "Live status" indicator: heartbeat ৫ মিনিটের বেশি দেরি হলে red dot, না হলে green
- Master থেকে এক click-এ "Open tenant site" button (`tenant.domain` link)
- Per-tenant "Health score" badge — accounts_active / accounts_total ratio অনুযায়ী

---

## Backward compatibility
- পুরনো tenant build যা stats পাঠায় না → heartbeat আগের মতো কাজ করবে, UI-তে শুধু "No stats reported yet — update tenant CRM" message দেখাবে
- নতুন stats columns সব nullable / default 0, তাই কোনো breaking change নেই

Approve করলে আমি database migration, edge function update, এবং নতুন `TenantDetailPage` UI build করব। Tenant-side ২ ফাইলের patch একটা copy-paste block হিসেবে chat-এ দেওয়া হবে যাতে আপনি প্রতি tenant project-এ apply করতে পারেন।