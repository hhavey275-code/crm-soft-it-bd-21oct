# Plan: Exact Call Counting + Problem Accounts Page

## Goal

Tomar 3 ta jinish lagbe:
1. **Exact call count** per ad account: "500 limit e 100 call gese" — eyi format e dekhabe, percentage na
2. **Hold detection** — account active thakleo last bill failed thakle "hold" mark hobe
3. **Problem Accounts page** — admin dashboard e ek jaygay sob problem account list

---

## Part 1: Exact Call Counting (X / Limit)

### Meta API limits — actual numbers
Meta er documented hard limits (per ad account, per hour rolling window):
- **Development tier**: 60 calls + 300 × number_of_active_ads (max ~9000)
- **Standard tier**: 9000 calls + 100 × number_of_active_ads
- BM-level: 60 × users × hour
- App-level: 200 × users × hour

Meta header `X-Ad-Account-Usage` returns `acc_id_util_pct` (percentage only), kintu **exact call count return kore na**. Tai amader nije count korte hobe.

### Approach: Self-counting table
Protita Meta API call er age ekta counter increment korbo:

```
ad_account_call_log
- ad_account_id
- called_at (timestamptz)
- endpoint (insights / spend_cap / campaigns / etc)
- status_code
- error_code (Meta er #17, #368 etc)
- error_message
```

Then "last 1 hour e koto call" easily count: `SELECT count(*) WHERE called_at > now() - interval '1 hour'`.

Limit estimate: amra `access_tier` (dev/standard) detect korbo `X-Business-Use-Case-Usage` header theke + active ads count theke calculate korbo: `60 + 300 × active_ads` or `9000 + 100 × active_ads`.

### UI display
Existing `RateLimitBadge` update: "100 / 9000 calls (1h)" + percentage tooltip e.

---

## Part 2: Hold Detection (active + last bill failed)

Tomar definition: account `status = active`, kintu last billing attempt failed.

Detection sources (sob already ase):
- `failed_topups` table — failed top-up attempts
- `ad_account_call_log` — Meta error codes: #17 (request limit), #368 (temporarily blocked), #100 subcode 1487742 (account temp disabled), billing_hold messages
- `ad_account_insights.amount_spent` flat thaka (no spend in 24h despite active campaign) = soft signal

### Logic
```
is_held = (status='active') AND (
  (last_failed_topup_at > last_successful_topup_at)
  OR (recent meta error code IN (17, 368, 1487742))
  OR (no spend in 24h AND has active campaign)
)
```

New view `v_problem_ad_accounts` — joins ad_accounts + failed_topups + recent errors.

---

## Part 3: Problem Accounts Page (Admin)

New route: `/admin/problem-accounts`

### Layout
```
┌─────────────────────────────────────────────────────┐
│ Problem Accounts (12)              [Refresh] [Filter]│
├─────────────────────────────────────────────────────┤
│ Account     │ Calls(1h) │Last Error│ Failed Bills│Action│
├─────────────┼───────────┼──────────┼─────────────┼──────┤
│ act_1234... │ 450/500 🔴│#17 30m ago│ 3 in 24h   │ View │
│ Client: ABC │           │ rate limit│             │      │
└─────────────────────────────────────────────────────┘
```

Filters: All / High call count / Recent errors / Failed billing / Suspected hold

Click "View" → drawer opens with:
- Hourly call count chart (last 24h)
- Recent Meta errors list (code, message, timestamp)
- Failed top-up history
- Card/issuer info (current card on file)

### Diagnosis hint
Since tumi confused — issuer fault na Meta fault — drawer e ekta "Likely Cause" badge:
- 🟠 **Rate limit** — if calls > 80% of limit
- 🔴 **Meta flag** — if Meta error #368 / #1487742 present, but call count low
- 💳 **Card issuer** — if no Meta error, just billing failed (issuer declined)
- ⚠️ **Mixed** — multiple signals

---

## Database Changes

```sql
-- 1. Call log (high-volume, indexed for time-window queries)
CREATE TABLE ad_account_call_log (
  id bigserial PRIMARY KEY,
  ad_account_id uuid REFERENCES ad_accounts(id) ON DELETE CASCADE,
  called_at timestamptz NOT NULL DEFAULT now(),
  endpoint text,
  status_code int,
  error_code int,
  error_subcode int,
  error_message text
);
CREATE INDEX idx_call_log_acc_time ON ad_account_call_log(ad_account_id, called_at DESC);

-- 2. Add limit estimate to ad_account_rate_limits
ALTER TABLE ad_account_rate_limits 
  ADD COLUMN access_tier text,
  ADD COLUMN active_ads_count int,
  ADD COLUMN estimated_call_limit int;

-- 3. Auto-purge old logs (keep 7 days)
-- pg_cron job: DELETE FROM ad_account_call_log WHERE called_at < now() - interval '7 days'
```

---

## Code Changes

| File | Change |
|---|---|
| `supabase/functions/_shared/meta-fetch.ts` | After every call, insert row in `ad_account_call_log` (fire-and-forget) |
| `supabase/functions/_shared/persist-rate-limits.ts` | Detect access_tier from BUC header; estimate call limit |
| `src/components/RateLimitBadge.tsx` | Show "100/500 calls (1h)" instead of just % |
| `src/routes/admin.problem-accounts.tsx` | New route |
| `src/components/admin/ProblemAccountsPage.tsx` | New table + drawer |
| `src/components/admin/ProblemAccountDrawer.tsx` | Detail view: chart, errors, billing history |
| `src/components/AppSidebar.tsx` | Add "Problem Accounts" link (admin only) |

---

## Open question

Call log table volume estimate kichu:
- Tomar daily roughly koto Meta call hoy? (1k? 50k? 500k?)
- Eta jante hobe — 50k+ daily hole 7 days = 350k rows, fine. But 500k+ daily hole partition korte hobe.

Jodi exact number na jano, default **7 days retention** thakbe, scale dekhle adjust korbo.
