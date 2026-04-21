

## আমি আপনার কথা ভালো করে বুঝেছি ✅

আপনার screenshot-এর `৳42,56,500` (green) আসলে **City Bank chip-এর per-bank cash-in value**, Due/Advance balance নয়। আপনি চাচ্ছেন ওই TOTAL row-এ এই card-এর payment দেওয়ার পর যে **running Due/Advance** হয়েছে সেটা দেখাতে — অর্থাৎ Apr 22-এর ৳800,000 BDT Payment এর জন্য `Due −৳48,09,340`।

### Database verification (confirm করেছি):

| Date | Type | Amount | Running Balance |
|---|---|---|---|
| **Apr 22, 2026** | BDT Payment | +৳800,000 | **Due −৳48,09,340.66** ⬅ এটাই দেখাবে |
| Apr 21, 2026 | Client Top-Up | +৳38,400 | Due −৳56,09,340.66 |
| Apr 21, 2026 | Client Top-Up | +৳38,400 | Due −৳56,47,740.66 |
| Apr 21, 2026 | Client Top-Up | +৳12,800 | Due −৳56,86,140.66 |
| Apr 21, 2026 | BDT Payment | +৳128,000 | Due −৳56,98,940.66 |
| ... | ... | ... | ... |

Code-এ `formatDueAdvance(runningTotals.get(t.id))` already wired আছে (line 565, 687)। কিন্তু আপনার browser-এ পুরোনো cached JavaScript bundle চলছে, তাই নতুন value দেখাচ্ছে না।

---

## Plan

### 1. Cache-bust করে force fresh build

`SellerDashboard.tsx` ফাইলের top-এ একটা version comment + অন্য একটা cosmetic change করব যাতে Vite নতুন bundle hash তৈরি করে এবং browser-এ পুরোনো `.js` চলতে না পারে।

### 2. TOTAL row-কে আরও clear + visual করব

বর্তমান mobile card footer:
```
TOTAL · Due           −৳48,09,340.66
```

নতুন format (আরো boro, eye-catching, calculation breakdown সহ):
```
┌─────────────────────────────────────────┐
│ 📊 RUNNING BALANCE        +৳800,000     │
│                                          │
│ Due −৳48,09,340.66                       │
│ ─────────────                            │
│ এই payment-এর পর আপনি এই amount দিতে    │
│ বাকি (negative = Due, positive = Adv)   │
└─────────────────────────────────────────┘
```

প্রতিটা card-এ থাকবে:
- **এই transaction-এর delta** (সবুজ +৳ বা লাল −৳, কত যোগ/বিয়োগ হয়েছে)
- **এই transaction-এর পর running balance** (লাল Due বা নীল Advance)
- **Calculation arrow**: `Previous balance → +/− delta → New balance` ছোট লাইনে

আপনার চাওয়া অনুযায়ী **Advance হলে নীল (blue)**, **Due হলে লাল (red)** color হবে (আগে advance-এ green ছিল, blue-তে change করব)।

### 3. Desktop table column-এও same color rule

Desktop view-র "Due/Advance (৳)" column-এর header + value-তে blue-for-advance, red-for-due apply হবে।

### 4. AdminSellers.tsx-এ একই update

Admin view-এর mobile card footer ও same calculation breakdown এবং blue/red color পাবে।

### 5. BalanceHistoryChart-এও color update

Chart-এর line + timeline pills-এ Advance = blue (আগে green ছিল), Due = red থাকবে।

### 6. `formatDueAdvance` helper update

`sellerRunningTotal.ts` এ helper function-এর return এ `isAdvance` flag আছে — কিছু change লাগবে না, শুধু consumer-গুলোতে color class swap (`emerald-` → `sky-` / `blue-`)।

---

## Technical Details

- **Color tokens**:
  - Advance (positive): `text-sky-600 dark:text-sky-400`, bg `bg-sky-500/10`, border `border-sky-500/40`
  - Due (negative): `text-rose-600 dark:text-rose-400`, bg `bg-rose-500/10`, border `border-rose-500/40`
- **Per-row delta** calculate করব row-level useMemo-এর পরিবর্তে inline (ছোট data, ১বার pass)। Logic: `bdt_payment/client_topup` → +bdt, `withdraw` → −bdt, `usdt_received` → −(usdt × rate)।
- **Cache-bust**: top-এ `// v2026.04.22-balance-display` marker comment + import order মাইন্যাচার টুইক যাতে output bundle hash change হয়।

---

## Files Touched

- `src/components/seller/SellerDashboard.tsx` — mobile card-এ enhanced TOTAL footer (delta + running balance + arrow), desktop column blue/red colors, cache-bust marker.
- `src/components/admin/AdminSellers.tsx` — same enhanced footer for admin's seller view.
- `src/components/seller/BalanceHistoryChart.tsx` — Advance color green → blue.
- `src/lib/sellerRunningTotal.ts` — কোনো logic change নয়, শুধু comment clarification।

---

## Final result (mobile card preview)

```
🟢 BDT Payment                Apr 22, 2026  🗑
👤 Jahidul Kabir
─────────────────────────────────
BDT  ৳800,000.00       USDT  $0.00
Rate 0.0               Conv  ৳0.00
🏦 City bank — 1454533103001
   Binary Digital printing
TrxID: 261121728464          🖼 View
═════════════════════════════════
📊 RUNNING BALANCE  +৳8,00,000
   Due −৳48,09,340.66
   (এই payment-এর পরে balance)
═════════════════════════════════
```

এখন আপনি প্রতিটা card-এ পরিষ্কার দেখবেন: কত টাকা ঢুকল, কত due কমল, এবং final due কত হলো।

