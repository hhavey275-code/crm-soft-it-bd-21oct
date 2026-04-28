# সব Meta API call → Vercel Proxy দিয়ে যাবে (Unified)

## বর্তমান অবস্থা

ভালো খবর: সব Meta Graph API call already `metaFetch()` wrapper দিয়ে যাচ্ছে — কোথাও bare `fetch("https://graph.facebook.com/...")` নেই।

খারাপ খবর: **৭ টা আলাদা ফাইলে ৭ টা আলাদা `metaFetch` implementation** আছে এবং তাদের behavior inconsistent:

| File | Proxy timeout? | Fallback rule | সমস্যা |
|------|---------------|---------------|--------|
| `spend-cap-update` | ✅ 8s | 5xx/HTML/proxy-error → fallback | ✅ Correct |
| `spend-cap-withdraw` | ❓ | ❓ | check করা দরকার |
| `scheduled-sync` | ❓ | ❓ | check করা দরকার |
| `get-account-insights` | ❌ no timeout | শুধু HTML/proxy-own-error fallback | hung proxy = function timeout |
| `retry-failed-topup` | ✅ 8s | < 500 = healthy | OK |
| `ocr-seller-payment` (uses `_shared/ocr-fallback.ts`) | n/a | n/a | Meta call নেই |
| `ads-manager-campaigns` edge | ❓ | ❓ | check করা দরকার |
| `src/routes/api.ads-manager.campaigns.ts` | ❌ no timeout | catch only on throw | proxy slow হলে hang |

`api.meta-proxy.ts` (`/api/meta-proxy`) — এটা নিজে Vercel-side proxy route, allowedHosts এ `graph.facebook.com` আছে। ✅

## যা করব

### Step 1: একটা shared `metaFetch` module তৈরি
File: `supabase/functions/_shared/meta-fetch.ts`

একটাই canonical implementation যেটা **সব edge function** import করবে:
- Proxy-first (POST to `META_PROXY_URL` with `META_PROXY_SECRET`)
- 8-second AbortController timeout — proxy hang হলে দ্রুত fallback
- Fallback **শুধু** এই cases এ:
  - Network throw / timeout
  - HTTP 5xx response
  - HTML body (proxy down page)
  - Proxy-own-error JSON (`{"error": "string"}`)
- Meta এর 4xx/200 valid responses পাস-থ্রু (যেমন rate limit, validation error) — direct fallback **না**, কারণ same IP rotation safe রাখা দরকার
- Per-request counters: proxy call count, direct call count, last egress IP, fail reasons
- Helper: `getMetaCallSummary()` for logging

### Step 2: প্রতিটা edge function refactor

প্রতিটা ফাইলের local `metaFetch` মুছে shared module থেকে import করব:
- `supabase/functions/spend-cap-update/index.ts`
- `supabase/functions/spend-cap-withdraw/index.ts`
- `supabase/functions/scheduled-sync/index.ts`
- `supabase/functions/get-account-insights/index.ts`
- `supabase/functions/retry-failed-topup/index.ts`
- `supabase/functions/ads-manager-campaigns/index.ts`

ফলাফল: behavior 100% consistent — **কোনো Meta call direct যাবে না, যদি proxy reachable থাকে এবং valid response দেয়**।

### Step 3: Vercel-side route (`src/routes/api.ads-manager.campaigns.ts`)

এখানেও `metaFetch` আছে কিন্তু behavior weak। একই rule apply করব (timeout + smart fallback)। Vercel route গুলোর জন্য আলাদা shared util: `src/lib/server/meta-fetch.server.ts` (server-only)।

### Step 4: Verification logging

প্রতিটা successful Meta call এ response header `x-egress-ip` capture করে log এ লিখব। User dashboard / system_logs এ যাচাই করা যাবে — সব call same proxy IP দিয়ে যাচ্ছে কিনা।

## বাস্তবায়ন প্রভাব

- ✅ সব Meta call (spend cap update/withdraw, insights, scheduled sync, campaigns, retries) proxy-first
- ✅ Same egress IP — Facebook এর কাছে ১টাই IP দেখাবে → "different IP" anti-fraud signal কমবে
- ✅ Proxy fail হলে automatic direct fallback — feature কখনো broken হবে না
- ✅ Timeout protection — hung proxy 8s এর বেশি block করবে না
- ✅ একটা shared file edit করলেই সব function এ effect — future maintenance সহজ

## কোনো breaking change নেই

- API surface unchanged
- Database/UI unchanged
- শুধু internal Meta routing উন্নত হবে

## Approve করলে এই ফাইলগুলো বদলাবে

1. **New:** `supabase/functions/_shared/meta-fetch.ts`
2. **New:** `src/lib/server/meta-fetch.server.ts`
3. **Edit:** `supabase/functions/spend-cap-update/index.ts`
4. **Edit:** `supabase/functions/spend-cap-withdraw/index.ts`
5. **Edit:** `supabase/functions/scheduled-sync/index.ts`
6. **Edit:** `supabase/functions/get-account-insights/index.ts`
7. **Edit:** `supabase/functions/retry-failed-topup/index.ts`
8. **Edit:** `supabase/functions/ads-manager-campaigns/index.ts`
9. **Edit:** `src/routes/api.ads-manager.campaigns.ts`