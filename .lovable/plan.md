

## Bug: Auto/Manual Top-Up Telegram Message-এ ভুল "Total" যাচ্ছে

### সমস্যা

Telegram-এ payment proof forward হওয়ার সময় **Total** line-এ ভুল number আসছে:
- Screenshot-এ দেখাচ্ছে: `Total: ৳4,620,100` (শুধু Eastern Bank-এর cash-in sum)
- আসল seller balance: `Due −৳3,492,540.66` (সব bank মিলে, USDT given বাদ দিয়ে)

### Root Cause

দুটো deployed edge function-এ পুরোনো ভুল calculation logic রয়ে গেছে:

1. **`forward-proof`** (manual top-up approve হলে call হয়) — শুধু `bank_account_id` filter করে total compute করে, USDT given বাদ দেয়।
2. **`verify-topup`** (auto-verify / Telegram SMS match হলে in-line forward করে) — একই ভুল per-bank logic ব্যবহার করে।

দুটোর pattern:
```
SELECT type, bdt_amount FROM seller_transactions WHERE bank_account_id = X
total = sum(bdt_payment + client_topup) - sum(withdraw)
// ❌ usdt_received (USDT given) বাদ
// ❌ অন্য bank-এর entries বাদ
// ❌ rate × usdt_amount conversion বাদ
```

OCR দিয়ে seller payment submit-এর flow-এ আলাদা `forward-seller-proof` function ব্যবহার হয় যেটা ঠিক — পুরো seller-এর সব transaction নিয়ে global Due/Advance compute করে। সে কারণেই OCR-এর Total ঠিক, কিন্তু top-up-এর Total ভুল।

### Fix Plan

দুটো edge function update করে সঠিক global Due/Advance logic বসাতে হবে — exact same formula যা `forward-seller-proof` use করে।

**1. `supabase/functions/verify-topup/index.ts`** (auto-verify path)
- Per-bank total compute সরিয়ে seller-wide compute বসানো:
  ```ts
  const { data: txns } = await supabase
    .from('seller_transactions')
    .select('type, bdt_amount, usdt_amount, rate, status, created_at')
    .eq('seller_id', sellerId);

  let balance = 0;
  for (const t of txns) {
    if ((t.status || 'approved') !== 'approved') continue;
    if (t.type === 'bdt_payment' || t.type === 'client_topup') balance += +t.bdt_amount;
    else if (t.type === 'withdraw') balance -= +t.bdt_amount;
    else if (t.type === 'usdt_received') balance -= (+t.usdt_amount) * (+t.rate);
  }
  ```
- Total line format `forward-seller-proof`-এর সাথে identical:
  - `balance > 0` → `🟢 Total: Advance +৳{abs}`
  - `balance < 0` → `🔴 Total: Due −৳{abs}`
  - `balance === 0` → `⚪ Total: ৳0`

**2. `supabase/functions/forward-proof/index.ts`** (manual approve path)
- উপরের একই formula বসানো
- Bank lookup-এ আগে থেকেই `seller_id` resolve করে নেওয়া

**3. `src/components/admin/AdminTopUp.tsx`** (manual approve path simplification)
- এখন duplicate Telegram message যাচ্ছে: `forward-proof` (ভুল) + `forward-seller-proof` (ঠিক)। `forward-proof` fix হওয়ার পর duplicate দরকার নেই।
- Line 458–488-এর fallback `forward-seller-proof` invoke সরিয়ে দেওয়া (only one message যাবে — `forward-proof` দিয়েই, যেটা এখন সঠিক total নিয়ে আসবে)।

**4. `supabase/functions/forward-seller-proof/index.ts`** — কোনো পরিবর্তন লাগবে না, এটাই reference।

### Tenant payment path (verify needed before edit)

Tenant top-up auto-verify path-এও একই ভুল আছে কিনা সেটা `verify-topup` (বা `tenant-webhook`) source দেখে confirm করে একই fix apply করা হবে।

### Deploy

`verify-topup` এবং `forward-proof` redeploy করা হবে। AdminTopUp.tsx normal frontend deploy-এ যাবে।

### আপনি কীভাবে check করবেন

Fix-এর পর একটা client top-up auto বা manual approve দিন → Telegram-এ একটাই message আসবে, এবং Total line-এ App-এর ledger-এর Due/Advance value-এর সাথে exact mil থাকবে (যেমন `🔴 Total: Due −৳3,492,540.66`)।

