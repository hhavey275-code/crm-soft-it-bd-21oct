# Daily Spending Limit — Meta API theke ana

## Tumi ki chao

Per ad account er **Daily Spending Limit** Meta API theke real-time ana, ar `AdAccountDetailPage` e admin + client dujonei dekhabe. Sob ad account er na — shudhu detail page e jokhon ekta account khulchi tokhon.

## Meta API te ki ache

Meta `/act_<id>` endpoint e duita related field expose kore:

- `**adtrust_dsl**` — Account-level Daily Spend Limit (Meta er trust-based limit; "$X tar beshi ek dine spend kora jabe na" — eta tomar exact target)
- `**min_daily_budget**` — Currency er minimum daily budget (kom important)

`**adtrust_dsl` reliability:**

- Active spending account e mostly value asay (eg. 50, 250, 1000, 7500 — minor units e)
- Nuton/unverified account e `null` ba `0` aste pare
- Permission lage — `ads_read` / `ads_management` (already amader BM token e ache)

Mane: jeshob account e Facebook-er actual daily limit ache, oishob e value asbe. Baki gulo te `—` dekhabo.

## Approach: On-demand fetch (sob account er na)

Tumi bolso "sob account er na" — eta important. Duita option:

**Option A (recommended):** Detail page jokhon open hoy, tokhon shei ekta account er jonno fresh `adtrust_dsl` fetch kora. Sob bulk sync e add korbo na — extra latency nei, ar always realtime/accurate.

**Option B:** Bulk sync e add kora (`get-account-insights` e). Eta jokhon "Update All" run hoy tokhon save hobe — kintu detail page ee realtime na, last sync er purono value dekhabe.

Ami **Option A** suggest korchi — karon tumi bolecho "realtime and accurate". Detail page e jokhon ekta account dekhche, tokhon ekta light Meta call kore latest value ene dekhabo. Bulk sync untouched.

Option A koro,kintu auto fetch korar dorkar nai,limit check button [diyo.click](http://diyo.click) korle tokhon api realtime data [anbe.ad](http://anbe.ad) acc details page e dhukley jodi call hoy,api call barbe.button thkbr jeta jeta lagbe click kore dekhe nibe. kintu call jeno proxy diye jay, ip show koraba, 

## Plan

### 1. Notun edge function: `get-ad-account-limits`

Choto ekta function — input: `ad_account_id` (DB row id). Eta korbe:

1. DB theke `account_id` (act_xxxxx) ar BM `access_token` ber kore
2. `metaFetch` diye proxy hoye call:
  ```
   GET /act_<id>?fields=adtrust_dsl,min_daily_budget,currency
  ```
3. `adtrust_dsl` parse — Meta minor units e dey, `/100` kore USD-e convert (currency check kore)
4. Return: `{ daily_spend_limit: number, currency: string, fetched_at: ISO }`
5. Side effect: `ad_accounts.daily_spend_limit` column o update kore dey (ja future bulk display e o kaje lage)

Auth check: caller authenticated user hote hobe; account access check (admin OR shei client jar account)

### 2. `AdAccountDetailPage.tsx` — UI

Existing 4-card grid er nichee ekta notun small section ba 5th metric card add korbo:

```
Daily Spending Limit
$250.00            (Meta-set limit)
auto-refresh on open
```

- Page load e immediately edge function call hobe
- Loading state e skeleton/spinner
- Value 0/null hole "Not set by Meta" subtitle dekhabo
- Manual refresh button (icon) — recall korbe

Existing useQuery use kore cache + refetch handle korbo.

### 3. Access — admin + client dujonei

`AdAccountDetailPage` already admin/client dujonei accessible (route guard + RLS already configured). Notun edge function eo:

- Admin/superadmin: shob account
- Client: shudhu nijer assigned account (`ad_accounts.client_id = auth.uid()`)
- Agency: nijer agency er accounts

Eta ensure korbe je client jar partial access ache, oo daily limit dekhte parbe — ja tomar main pain point.

## Files to touch

- `supabase/functions/get-ad-account-limits/index.ts` — new edge function
- `src/components/pages/AdAccountDetailPage.tsx` — notun metric card + fetch hook
- (Optional) `src/lib/fetchAdAccountLimits.ts` — small client helper

## Risk / caveats

- Kichu account e Meta `null` return korbe — eta "limit nei" mane na, mane "Meta expose kortese na". UI te politely "—" ba "N/A" dekhabo, error noy.
- Currency variation — jodi BDT account thake, USD convert kora jabe na directly. Currency field check kore "৳250" / "$250" properly format korbo.
- Extra Meta call per detail-page-visit — proxy hoye jabe (existing `metaFetch`), Facebook IP rotation issue nei.

Ami eke implement kori? Tumi ki Option A (on-demand, realtime — recommended) chao naki Option B (bulk sync e add)?