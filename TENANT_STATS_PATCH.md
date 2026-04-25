# Tenant Stats Patch — Apply to each Tenant Project

এই patch দুইটা/তিনটা tenant project এ paste করতে হবে। Goal: master admin
যখন **Refresh Stats from Tenant** button চাপবে, tenant তার own Supabase
থেকে aggregate করে JSON return করবে — **Meta API তে কোনো call হবে না**।

---

## 1) Edge Function update — `supabase/functions/tenant-webhook/index.ts`

Tenant এর `tenant-webhook` function এর action handler এ নতুন `pull_stats`
case যোগ করতে হবে। আর heartbeat handler কে আগের simple license-only
behavior এ revert করতে হবে।

### Add this `pull_stats` case (inside the action switch)

```ts
case "pull_stats": {
  // Aggregate stats from tenant's own Supabase. NO Meta calls.
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    accountsRes,
    insightsRes,
    walletsRes,
    profilesRes,
    todayTopupsRes,
    pendingTopupsRes,
  ] = await Promise.all([
    supabase.from("ad_accounts").select("id, status, account_id, account_name, updated_at"),
    supabase.from("ad_account_insights").select("ad_account_id, today_spend, yesterday_spend, today_orders, yesterday_orders, balance, last_spend_date"),
    supabase.from("wallets").select("balance"),
    supabase.from("profiles").select("user_id, status"),
    supabase
      .from("top_up_requests")
      .select("id, amount")
      .gte("created_at", `${todayStr}T00:00:00Z`),
    supabase
      .from("top_up_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const accounts = accountsRes.data ?? [];
  const insights = insightsRes.data ?? [];
  const wallets = walletsRes.data ?? [];
  const profiles = profilesRes.data ?? [];
  const todayTopups = todayTopupsRes.data ?? [];

  const accountsTotal = accounts.length;
  const accountsActive = accounts.filter((a: any) => a.status === "active").length;
  const accountsDisabled = accounts.filter((a: any) => a.status === "disabled").length;
  const accountsInactive = accounts.filter((a: any) =>
    a.status !== "active" && a.status !== "disabled"
  ).length;

  const insightsByAcct: Record<string, any> = {};
  for (const i of insights) insightsByAcct[i.ad_account_id] = i;

  const spendToday = insights.reduce((s: number, i: any) => s + Number(i.today_spend ?? 0), 0);
  const spendYesterday = insights.reduce((s: number, i: any) => s + Number(i.yesterday_spend ?? 0), 0);
  const ordersToday = insights.reduce((s: number, i: any) => s + Number(i.today_orders ?? 0), 0);
  const ordersYesterday = insights.reduce((s: number, i: any) => s + Number(i.yesterday_orders ?? 0), 0);

  // Lifetime / month spend — best-effort from ad_accounts.amount_spent if column exists
  const spendLifetime = (accounts as any[]).reduce(
    (s, a) => s + Number(a.amount_spent ?? 0), 0
  );

  // Month spend — try daily_spend_snapshots if available
  let spendMonth = 0;
  try {
    const { data: dailyRows } = await supabase
      .from("daily_spend_snapshots")
      .select("total_spend, snapshot_date")
      .gte("snapshot_date", monthStart.toISOString().slice(0, 10));
    spendMonth = (dailyRows ?? []).reduce(
      (s: number, r: any) => s + Number(r.total_spend ?? 0), 0
    );
  } catch { /* table may not exist on tenant */ }

  const totalWallet = wallets.reduce((s: number, w: any) => s + Number(w.balance ?? 0), 0);
  const totalClients = profiles.length;

  const topupsTodayCount = todayTopups.length;
  const topupsTodayAmount = todayTopups.reduce(
    (s: number, t: any) => s + Number(t.amount ?? 0), 0
  );
  const topupsPending = pendingTopupsRes.count ?? 0;

  const topAccounts = accounts
    .map((a: any) => {
      const ins = insightsByAcct[a.id] || {};
      return {
        id: a.id,
        account_id: a.account_id,
        account_name: a.account_name,
        status: a.status,
        today_spend: Number(ins.today_spend ?? 0),
        balance: Number(ins.balance ?? 0),
        last_spend_date: ins.last_spend_date ?? null,
      };
    })
    .sort((a: any, b: any) => b.today_spend - a.today_spend)
    .slice(0, 50);

  return json({
    ok: true,
    stats: {
      accounts_total: accountsTotal,
      accounts_active: accountsActive,
      accounts_disabled: accountsDisabled,
      accounts_inactive: accountsInactive,
      spend_today: spendToday,
      spend_yesterday: spendYesterday,
      spend_this_month: spendMonth,
      spend_lifetime: spendLifetime,
      orders_today: ordersToday,
      orders_yesterday: ordersYesterday,
      total_wallet_balance: totalWallet,
      total_clients: totalClients,
      topups_today_count: topupsTodayCount,
      topups_today_amount: topupsTodayAmount,
      topups_pending: topupsPending,
      top_accounts: topAccounts,
    },
  });
}
```

### Revert heartbeat — keep it license-only (no stats)

`heartbeat` action এ যদি আগে stats parsing/snapshot insert logic যোগ
হয়ে থাকে, সেটা remove করুন। Heartbeat আবার শুধু license status return
করবে:

```ts
case "heartbeat": {
  // License check only — NO stats. Stats are pulled on-demand by master.
  return json({
    ok: true,
    status: tenant.status,                  // active | frozen | suspended
    system_limit: tenant.system_limit,
    total_used: tenant.total_used ?? 0,
    subscription_type: tenant.subscription_type,
    subscription_paid_until: tenant.subscription_paid_until,
    subscription_fee: tenant.subscription_fee,
    usd_rate: tenant.usd_rate,
  });
}
```

---

## 2) `useTenantLicense.ts` — keep as-is

আগের iteration এ যদি heartbeat call এ stats পাঠানোর change হয়ে থাকে,
সেটা **revert** করুন। Heartbeat call শুধু এটাই থাকবে:

```ts
body: JSON.stringify({ action: "heartbeat" }),
```

কোনো stats payload পাঠানো লাগবে না।

---

## 3) Master CRM এ tenant configuration

Master admin এ প্রতিটা tenant এর জন্য নিচের দুটো column set করতে হবে
(SQL Editor বা TenantDetailPage UI দিয়ে):

```sql
UPDATE public.tenants
SET
  webhook_url   = 'https://<tenant-supabase-ref>.supabase.co',
  pull_api_key  = '<same X-Tenant-Key the tenant accepts>'
WHERE id = '<tenant-uuid>';
```

- `webhook_url` = tenant এর Supabase project URL (e.g. `https://abcd1234.supabase.co`)
- `pull_api_key` = tenant এর `tenant-webhook` function যেই `X-Tenant-Key`
  header accept করে — সেটাই (master ও tenant উভয় side same secret)

---

## 4) Verify

1. Tenant project এ patch deploy হওয়ার পর master admin এ tenant detail
   page খুলুন।
2. **Refresh Stats from Tenant** button চাপুন।
3. Loading শেষ হলে metric cards আর top accounts populate হবে।
4. Tenant এর Meta API call counter check করুন — **0 extra call** হওয়ার কথা।

কোনো error হলে master admin এ network tab → `tenant-pull-stats`
function এর response দেখুন; বা edge function logs check করুন।