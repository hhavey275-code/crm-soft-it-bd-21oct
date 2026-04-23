

# Failed Top-Up Verification Report

## প্রশ্ন: ki kokhon failed_topups e jay? Spend cap update hoye thakleo ki failed dekhate pare?

## কোডে যা পেলাম (`spend-cap-update` edge function)

৬টা scenario আছে যেটায় record `failed_topups` table এ insert হয় — wallet টা **আগেই deduct হয়ে গেছে**, তারপর Meta API call করা হয়:

| # | Trigger | Wallet status | Cap actually updated? |
|---|---------|---------------|----------------------|
| 1 | Meta POST returned error AND verify-GET shows cap **not** changed | Deducted | No → genuinely failed |
| 2 | Meta POST returned error BUT verify-GET shows cap **already correct** | Deducted | **Yes** → auto-recovered, NOT marked failed (line 313-356) |
| 3 | Verify GET itself fails (HTTP error) | Deducted | Unknown → marked failed |
| 4 | Verify GET succeeds but `verifiedDollars ≠ expected` (>$0.02 diff) | Deducted | Partially / no → marked failed |
| 5 | Verify GET returns no `spend_cap` field | Deducted | Unknown → marked failed |
| 6 | Network exception thrown (timeout, fetch error) | Deducted | Unknown → marked failed |
| 7 | Rate limit retries exhausted (`META_RATE_LIMIT_RETRY_EXHAUSTED`) | Deducted | No (POST never went through) | 

## "Cap update hoyeche kintu UI failed dekhacche" — eta possible?

**হ্যাঁ, possible — দুইটা bug আছে:**

### Bug 1: Verify GET timeout / proxy hiccup (scenario 3, 5, 6)
POST সফল হয়ে Meta-তে cap update হয়ে গেছে, কিন্তু verify GET timeout/proxy error দিল। কোড সরাসরি `failed_topups` এ insert করে দেয় — POST আসলে সফল হয়েছে কিনা সেটা **double-check করে না**। এটা scenario 1-এ আছে (line 313-328 — POST error হলে GET দিয়ে recover করে), কিন্তু verify path-এ নাই।

### Bug 2: Mismatch tolerance খুব tight (scenario 4)
`Math.abs(verifiedDollars - newSpendCapDollars) < 0.02` — মানে $0.02 difference allowed। কিন্তু:
- Meta GET এ `centsToDollars(spend_cap)` করে — যদি Meta-র stored cap `$50.01` হয় আর expected `$50.00` হয়, তাহলে mismatch।
- System logs এ এমন entry আছে: `$25.01 → $50.010000000000005` — floating point precision। আবার কোনো account এ Meta প্রায়ই `+1¢` অফসেটে cap রাখে (currency conversion artifact)।
- এক্ষেত্রে cap actually update হয়ে গেছে, কিন্তু $0.01 mismatch-এর জন্য failed_topups এ চলে যাবে।

### Bug 3 (potential): POST rate-limit retry double-charge
`metaFetchWithRetry` rate-limited হলে retry করে। কিন্তু **POST রিকোয়েস্টও retry করে** — মানে প্রথম POST সফল (Meta-তে cap updated) কিন্তু response slow → next attempt আবার POST করে দিল → **cap দুইবার বাড়ল**। তারপর verify-এ `expected $X, got $X+amount` → mismatch → failed_topups এ যাবে যদিও cap actually আরো বেশি বেড়ে গেছে। POST কখনই idempotent না — POST retry করা risky।

## বর্তমান DB অবস্থা
- `failed_topups` table এখন **খালি** (0 rows)।
- গত ২ দিনে শেষ failure: 22 Apr — সব `META_RATE_LIMIT_RETRY_EXHAUSTED` বা `Meta HTTP 500`। এগুলো genuine — POST পৌঁছায়ই নাই।
- 21 Apr এর `Meta HTTP 500` গুলো all `via=direct` — proxy ছিল না।

## Conclusion

User এর সন্দেহ **সঠিক**: কিছু কেস-এ Meta-তে cap update হয়ে যাবার পরেও entry failed_topups-এ চলে আসতে পারে। মূলত:
1. Verify GET fail হলে কোড recovery check করে না।
2. $0.02 tolerance কম, floating point + Meta-র cent rounding mismatch করায়।
3. POST retry করার কারণে double-POST হলে cap বেশি বেড়ে যায়, system mismatch বলে।

## প্রস্তাবিত Fix (approve করলে implement করব)

### `supabase/functions/spend-cap-update/index.ts` এ ৪টা change:

1. **Verify GET fail হলে fallback recovery check** (scenario 3, 5, 6): যদি verify GET error দেয় বা empty আসে, ৩ সেকেন্ড wait করে আরেকবার GET try করব। তবুও fail হলে failed_topups-এ যাবে — কিন্তু `error_message`-এ স্পষ্ট লেখা থাকবে "POST may have succeeded — please verify in Meta before retry"।

2. **Mismatch tolerance বাড়ানো**: `< 0.02` → `< 1.00` (1 dollar)। Meta প্রায়ই currency conversion-এ small rounding করে; $1 এর কম diff হলে success ধরব। আর mismatch detect হলেও যদি `verifiedDollars >= newSpendCapDollars` (অর্থাৎ cap expected এর চেয়ে কম না), তাহলে success হিসেবে গ্রহণ করব।

3. **POST কখনো retry করা যাবে না**: `metaFetchWithRetry` এর POST এ `maxRetries=0` করব। শুধু GET-এ retry allowed। POST rate-limited হলে সরাসরি failed_topups-এ যাবে (cap untouched থাকবে — safe)।

4. **Race-safe verify**: POST-এর পর verify GET এ unique mismatch detect হলে আরো ১ বার retry-GET (proxy থেকে stale data আসতে পারে)।

### `supabase/functions/retry-failed-topup/index.ts`:
- একই tolerance fix (`< 1.00`) এবং ≥ check।
- এর জন্য আলাদা migration লাগবে না — শুধু edge function code change।

কোনো DB migration লাগবে না, শুধু ২টা edge function update হবে।

