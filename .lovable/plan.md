## Goal

Master admin এ tenant monitoring থাকবে, কিন্তু **Meta API কে কোনো extra/automatic call হবে না**। Stats শুধু তখনই refresh হবে যখন master admin manually button চাপবে — এবং তখনও tenant er Meta api  থেকে ডাটা আসবে

## Architecture (Updated)

### দুটো আলাদা Channel

**1. Heartbeat (automatic, 5 min) — অপরিবর্তিত**

- Tenant এর `useTenantLicense.ts` শুধু license status check করবে (frozen/active/limit)
- কোনো stats পাঠাবে না
- কোনো Meta call নেই

**2. Stats Pull (on-demand, manual)**

- Master admin `TenantDetailPage` এ "Refresh Stats" button চাপলে trigger হবে
- Master → Tenant এর `tenant-webhook` কে call করবে `action: "pull_stats"` দিয়ে
- Tenant তার **own Supabase tables** (`ad_accounts`, `ad_account_insights`, `wallets`, `top_up_requests`, `profiles`) থেকে aggregate করে JSON return করবে
- **Meta API কে কোনো call নেই** — tenant এর data যেটা ইতিমধ্যে তার own "Update All from Meta" দিয়ে populate হয়েছে, সেটাই use হবে
- Master সেটা `tenants.stats_*` columns আর `tenant_stats_snapshots` এ save করবে

### Data freshness model

Tenant detail page এ "Last refreshed: 2 hours ago" দেখাবে — আর "Refresh Stats" button পাশে থাকবে। Master admin যখন চাইবে তখনই fresh data টানবে। Auto polling নেই।

## Changes Required

### A. Master CRM (এই project)

**1. Edge Function update — `supabase/functions/tenant-webhook/index.ts**`

- Heartbeat handler থেকে stats parsing/snapshot logic **remove** করব (যেটা আগের iteration এ যোগ হয়েছিল)
- Heartbeat আবার শুধু license status return করবে (পুরোনো behavior)
- কারণ stats আর heartbeat এ আসবে না

**2. নতুন Edge Function — `supabase/functions/tenant-pull-stats/index.ts**`

- Master admin → এই function call করবে `tenant_id` দিয়ে
- Function সেই tenant এর `master_url` + tenant এর own API key বের করে (master CRM এ তো store করা নেই — তাই master কে tenant এর webhook URL জানতে হবে)
- **Approach**: Master এ `tenants` table এ ইতিমধ্যে `webhook_url` (tenant এর Supabase URL) আর `api_key` (master → tenant call করার জন্য shared secret) থাকা উচিত। যদি না থাকে, migration এ add করব
- Function tenant এর `pull_stats` endpoint কে hit করবে, response নিয়ে `tenants.stats_*` + `tenant_stats_snapshots` update করবে
- Return করবে fresh stats master UI কে

**3. UI update — `src/components/pages/TenantDetailPage.tsx**`

- যা আগের iteration এ build হয়েছে (metric cards, ad accounts tab, spend trend, activity tab) সব রাখব
- শুধু "Last sync" indicator এর পাশে **"Refresh Stats from Tenant"** button যোগ হবে
- Auto-refetch interval সরিয়ে দেব — শুধু button চাপলে refetch হবে
- Loading state দেখাবে button চাপলে

**4. Migration (small)**

- `tenants` table এ `webhook_url` (text) আর `pull_api_key` (text) column যদি না থাকে — add করব
- (আগের `stats_*` columns আর `tenant_stats_snapshots` table আগেই create হয়েছে, untouched থাকবে)

### B. Tenant Project Patch (আপনাকে দিতে হবে দুটো tenant এ)

**1. নতুন file — `src/lib/collectTenantStats.ts**`

- Tenant এর own Supabase থেকে query করে aggregate করবে:
  - `ad_accounts`: total / active / disabled / inactive count
  - `ad_account_insights`: today_spend sum, today_orders sum, monthly spend
  - `wallets`: total wallet balance (all clients)
  - `top_up_requests`: today count + amount, pending count
  - `profiles`: total clients, today active clients
  - Top 50 accounts by today_spend
- **কোনো Meta call নেই** — শুধু own DB read

**2. নতুন Edge Function — `supabase/functions/tenant-pull-stats/index.ts` (tenant side)**

- Master থেকে call আসবে `x-pull-key` header দিয়ে
- Validate করবে key, তারপর `collectTenantStats()` চালিয়ে JSON return করবে
- Lightweight, fast (1-2 sec, just DB queries)

**3. `useTenantLicense.ts` — অপরিবর্তিত থাকবে**

- আগের iteration এ যদি `stats` heartbeat এ পাঠানোর change হয়ে থাকে, সেটা **revert** করতে হবে
- Heartbeat আবার শুধু `{ action: "heartbeat" }` পাঠাবে

আমি এই দুটো file এর exact content `TENANT_STATS_PATCH.md` এ লিখে দেব master project এ — আপনি copy করে দুই tenant project এ paste করবেন।

## Meta API Impact


| Action                                   | Meta calls (before) | Meta calls (after)       |
| ---------------------------------------- | ------------------- | ------------------------ |
| Tenant heartbeat (5 min auto)            | 0                   | **0** ✅                  |
| Master "Refresh Stats" button            | —                   | **0** ✅ (tenant DB only) |
| Tenant "Update All from Meta" (existing) | N                   | N (অপরিবর্তিত)           |


মানে monitoring এর জন্য **Meta এ একটাও extra call হবে না**।

## Implementation Order

1. Migration: `tenants` এ `webhook_url`, `pull_api_key` column add (যদি না থাকে)
2. Master edge function `tenant-pull-stats` create
3. `tenant-webhook` heartbeat থেকে stats logic revert
4. `TenantDetailPage` এ "Refresh Stats" button + manual fetch logic
5. `TENANT_STATS_PATCH.md` update — tenant side patch (collectTenantStats + tenant-pull-stats edge function + heartbeat revert)