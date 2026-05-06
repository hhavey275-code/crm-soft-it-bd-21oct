# Per-Account Rate Limit Usage Badge

UI te protek ad account er next e Meta'r live rate limit usage % dekhabe. Source: Meta API response headers.

---

## 1. Data flow

```text
Meta API call (chunkedMetaSync / get-account-insights)
   ↓
Response headers parse:
   - X-Ad-Account-Usage     → per-account util %
   - X-Business-Use-Case-Usage → per-BM call_count, cputime, total_time
   - X-App-Usage             → per-app util %
   ↓
Save to DB (ad_account_rate_limits table)
   ↓
Frontend reads + shows badge
```

---

## 2. Database

**New table: `ad_account_rate_limits`**

| Column | Type | Note |
|---|---|---|
| id | uuid PK | |
| ad_account_id | uuid FK → ad_accounts | unique |
| acc_util_pct | numeric | from `X-Ad-Account-Usage.acc_id_util_pct` |
| reset_seconds | int | `reset_time_duration` |
| access_tier | text | `standard_access` / `development_access` |
| buc_call_count | numeric | from BUC header |
| buc_cputime | numeric | |
| buc_total_time | numeric | |
| estimated_regain_sec | int | `estimated_time_to_regain_access` |
| updated_at | timestamptz | |

**New table: `bm_rate_limits`** — same metrics but per BM
**New table: `app_rate_limits`** — per app_id (for future multi-app)

---

## 3. Backend changes

### 3.1 `supabase/functions/_shared/meta-fetch.ts`
- After every Meta response, parse 3 headers
- Expose helper: `getLastRateLimitHeaders()` returning parsed JSON

### 3.2 `chunkedMetaSync` + `get-account-insights` + `get-spend-only`
- After successful Meta call, upsert row into `ad_account_rate_limits` for each account in batch
- Also upsert into `bm_rate_limits` for the BM

### 3.3 `src/routes/api.ads-manager.campaigns.ts`
- Same: parse headers, upsert

---

## 4. Frontend (the badge)

### 4.1 New component: `<RateLimitBadge accountId={id} />`
- Reads from `ad_account_rate_limits` (live query, refetch every 30s)
- Color-coded:
  - 🟢 `< 50%` — green
  - 🟡 `50-79%` — yellow
  - 🟠 `80-94%` — orange
  - 🔴 `≥ 95%` or blocked — red, show countdown (`estimated_regain_sec`)
- Tooltip on hover: `call_count: 45%, cputime: 78%, total_time: 12% • Tier: standard_access • Resets in 23 min`

### 4.2 Where to show
- **Admin → AdAccounts table** — new column "Rate Limit"
- **Client → AdAccounts cards** — small badge corner
- **Ad Account Detail Page** — full breakdown card with all 3 metrics + BM-level + app-level

### 4.3 BM page badge
- Admin → Business Managers list e BM-level usage % badge
- Click korle detail dialog: BUC breakdown, top consuming accounts last hour

---

## 5. Limit numbers reference (tooltip te dekhabe)

| Tier | Calls/hour (BM) | Block duration |
|---|---|---|
| Development | ~60 | 1 hour |
| Standard | ~9,000 | up to 1 hour |
| Higher (high-spend, verified) | Dynamic, much higher | Shorter |

**Note:** Exact numbers Meta publish kore na — score % dekhe judge korte hobe. Insights endpoint heavy, eta cputime taratari barabe.

---

## 6. Edge cases

- **First call after deploy:** No data yet → badge shows "—" or "No data"
- **Header missing:** Some endpoints (e.g. token validation) header pathay na → skip update, keep old value
- **Stale data (>2 hour old):** Show grayed out with "Stale" label
- **Blocked account:** If `estimated_regain_sec > 0`, show countdown timer ticking live

---

## 7. Implementation order

1. Migration: 3 ti table (ad_account_rate_limits, bm_rate_limits, app_rate_limits) with RLS
2. `meta-fetch.ts` e header parser + getter
3. `chunkedMetaSync` e upsert logic (most calls eikhane jaay)
4. Frontend: `<RateLimitBadge />` component
5. AdminAdAccounts + ClientAdAccounts + AdAccountDetailPage e integrate
6. BM page e BM-level badge

---

## 8. What user gets

Akta typical view:

```text
Account: Shop ABC (act_123456789)
Status: ACTIVE  | Spend: $1,234  | Rate Limit: 🟡 67%
                                   ↑ hover: call=45%, cpu=67%, time=12%
                                            Tier: standard, resets in 18m
```

Block hole:
```text
Account: Shop XYZ
Status: ACTIVE  | Rate Limit: 🔴 BLOCKED — 42 min remaining
```

Eta diye tumi clearly dekhte parba kon account hot, kon BM saturated, kon app exhausted — multi-app strategy lagbe ki na decision nite parba data diye.
