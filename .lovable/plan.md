## Problem

`spend-cap-update` edge function top-up amount calculate করার সময় **CRM DB-তে stored পুরাতন `spend_cap`** কে base ধরছে — Meta-তে real-time যা আছে সেটা না।

```ts
// Current buggy logic (line 319-320)
const oldSpendCapDollars = Number(account.spend_cap);  // ← stale DB value
const newSpendCapDollars = oldSpendCapDollars + amount;
```

ফলে যখনই কেউ Meta-তে manually spend cap change করে কিন্তু CRM-এ "Update from Meta" দেয় না — পরের top-up সম্পূর্ণ ভুল amount-এ set হয়ে যায়।

---

## Fix: "Read live from Meta before write"

Top-up এর POST call করার ঠিক আগে Meta থেকে current `spend_cap` GET করে সেটার উপর top-up amount add করা হবে।

### Files to change

1. **`supabase/functions/spend-cap-update/index.ts`** (main fix)
2. **`supabase/functions/spend-cap-withdraw/index.ts`** (একই bug সম্ভবত)
3. **`supabase/functions/retry-failed-topup/index.ts`** (failed retry-এও same issue)
4. **`supabase/functions/scheduled-sync/index.ts`** (auto top-up — সাজেদুল ভাইয়ের ঘটনা; এখানেও same fix)

### Changes per file

**A. নতুন helper function** (spend-cap-update এ define, বাকিগুলোয় copy):

```ts
async function fetchLiveSpendCap(actId, bmToken) {
  try {
    const res = await metaFetch(
      `https://graph.facebook.com/v23.0/${actId}?fields=spend_cap,amount_spent&access_token=${encodeURIComponent(bmToken)}`,
      { method: "GET" }
    );
    const data = await res.json();
    if (!res.ok || data?.error) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      spendCapDollars: centsToDollars(Number(data.spend_cap || 0)),
      amountSpentDollars: centsToDollars(Number(data.amount_spent || 0)),
    };
  } catch (e) {
    return { ok: false, error: e?.message || "network error" };
  }
}
```

**B. Handler-এ POST call এর আগে inject:**

```ts
// BEFORE the existing POST block:
const live = await fetchLiveSpendCap(actId, bmToken);

if (!live.ok) {
  // Refund wallet if it was deducted
  if (shouldDeductWallet) {
    await supabase.from("wallets").update({ balance: Number(wallet.balance) }).eq("id", walletId);
    await supabase.from("transactions").insert({
      user_id: walletUserId, amount: amount, balance_after: Number(wallet.balance),
      type: "refund", description: `Auto-refund: could not read live spend cap (${live.error})`,
      reference_id: ad_account_id,
    });
  }
  return json({ error: `Cannot read live spend cap from Meta: ${live.error}. Top-up cancelled, wallet refunded.` }, 400);
}

const dbSpendCap = Number(account.spend_cap);
const liveSpendCap = live.spendCapDollars;
const drift = liveSpendCap - dbSpendCap;

// Drift warning log (helps you spot accounts with frequent manual changes)
if (Math.abs(drift) > 1) {
  await supabase.from("system_logs").insert({
    user_id: userId, user_name: userName,
    action: "Spend Cap Drift Detected",
    details: `${account.account_name} (${actId.replace(/^act_/, '')}) — DB=$${dbSpendCap.toFixed(2)}, Meta=$${liveSpendCap.toFixed(2)}, drift=$${drift.toFixed(2)}. Top-up calculated from Meta value.`
  });
}

// Use LIVE value as base, not DB
const newSpendCapDollars = liveSpendCap + amount;
```

**C. Success path-এ DB sync:**
POST success হওয়ার পর `ad_accounts` table update করার সময় `amount_spent` ও sync করা হবে (Meta থেকে live পাওয়া value দিয়ে), যাতে UI-র "Remaining Balance" ও সঠিক থাকে।

---

## Side Benefits

- Manually change করা spend cap auto-detect → আর "Update from Meta" manually চাপতে হবে না।
- Drift log থেকে admin বুঝবে কোন accounts frequent manually edit হচ্ছে।
- Auto top-up (scheduled-sync) ও safer হবে — সাজেদুল ভাইয়ের case-এ এটাই হয়তো হচ্ছিল।
- "Remaining Balance" UI সাথে সাথে accurate হবে।

## Trade-off

প্রতিটা top-up এ extra 1টা Meta GET call (~200-400ms latency বাড়বে)। কিন্তু money-correctness > speed।

---

## Confirmation needed

1. **Live read fail করলে কি করবো?**
   - **(recommended)** Top-up cancel করে wallet refund — safe
   - DB value ব্যবহার করে fallback — current behavior, ঝুঁকিপূর্ণ

2. **Drift threshold $1** ঠিক আছে নাকি ছোট করবো ($0.10)?

3. সব ৪টা function (spend-cap-update, spend-cap-withdraw, retry-failed-topup, scheduled-sync) একসাথে fix করে দেবো?

Approve করলে implement শুরু করছি।