

## Diagnosis (আপনার Screenshots-এর সাথে Code-এর Match)

আপনার দাবি দুটো:
1. **প্রতিটি payment/withdraw/USDT-এর পরে updated Due/Advance balance row-এর সাথে দেখাতে হবে** (যেটা hero card-এর সাথে match করবে)
2. **BDT Payment ও Client Top-Up একই serial-এ thakbe (type-based grouping না)** — Excel-এও serial মেইনটেইন

### Code review করে যা পেলাম

**`src/components/admin/AdminSellers.tsx`** এবং **`src/components/seller/SellerDashboard.tsx`** — দুটোতেই:

✅ **Per-row running balance already আছে** — `runningTotals = computeDueAdvanceRunning(sellerTxns)` (line 436), table-এর `Due/Advance (৳)` column-এ render হচ্ছে (line 1284-1294)। আপনার screenshot-১ এর right-এর red box-এ যে `১,৫৬,৫২,২৬৯` → `১,৫৩,০২,২৬৯` দেখাচ্ছে — সেটা এই column।

✅ **Hero card final balance** (`+৳5,201,646.85 ADVANCE` / `−৳4,770,940.66 DUE`) — line 433 এ calc, line 783-803 এ render। Calculation: `totalBdtPaid + totalClientBdt − totalConvertedBdt − totalWithdrawn` — অর্থাৎ withdraw + USDT given উভয়ই বাদ দিচ্ছে। ✅ Correct।

✅ **Chronological serial already maintained** — DB query line 279: `.order("created_at", { ascending: false })` — newest first, **কোনো type-based grouping নেই**। `filteredTxns`-এ কোনো re-sort নেই (line 368-396)। Excel export-ও same `filteredTxns` order-এ যাচ্ছে।

### তাহলে আপনি যে সমস্যা দেখছেন সেটার আসল কারণ

Screenshot-১ এ যে দেখা যাচ্ছে "সব Client Top-Up উপরে, BDT Payment আলাদা" — এটা কোনো grouping না, এটা actual `created_at` order: আজকের (Apr 22) সবগুলোই Client Top-Up auto-approved হয়েছে আগে, BDT Payment গুলো পরে বা আরো আগে হয়েছে। DB-তে যে order এ row insert হয়েছে সেটাই দেখাচ্ছে।

কিন্তু একটা real edge-case আছে: যদি দুটো transaction **একই second-এ** insert হয় (auto top-up + manual BDT একসাথে), তখন `created_at` tie হলে browser-side render unpredictable হতে পারে।

---

## Plan — ২টা ছোট Improvement + 1 Confirmation

### 1. Stable secondary sort (tiebreaker for same-second txns)

`AdminSellers.tsx` (line 271-281) এবং `SellerDashboard.tsx`-এর equivalent query-তে **secondary order by `id`** add করব যাতে same `created_at` হলেও deterministic order থাকে এবং screen + Excel + Telegram সব জায়গায় same order:

```ts
.order("created_at", { ascending: false })
.order("id", { ascending: false })  // tiebreaker
```

`computeDueAdvanceRunning` function-এও same secondary sort add করব (`src/lib/sellerRunningTotal.ts` line 21, 64) — যাতে UI render order এবং running-total computation একদম sync থাকে।

### 2. Hero card-এ subtle hint

Hero card-এর `Due / Advance` value-এর নিচে একটা ছোট sub-label add করব: "After all transactions" — যাতে user বুঝতে পারে এটা পুরো ledger-এর cumulative balance, এবং row-এর `Due/Advance` column হলো সেই row পর্যন্ত running balance।

### 3. Excel sheet — same chronological order, no grouping

`exportToExcel` (line 445-486) ইতিমধ্যেই `filteredTxns` order use করছে — কোনো re-grouping নেই। Step-1 এর secondary sort apply হলে Excel-এও একই serial maintain হবে। **কোনো নতুন code change লাগবে না, automatically সঠিক হবে।**

### 4. Telegram forward-এ Due/Advance — Confirmed already working

`supabase/functions/forward-seller-proof/index.ts` line 96-122 — already সঠিকভাবে seller-এর সব approved txn fetch করে `computeDueAdvance()` দিয়ে total বের করছে এবং caption-এ `🟢 Total: Advance +৳X` বা `🔴 Total: Due −৳X` add করছে। **কোনো change দরকার নেই — শুধু verify করব next proof submit করার সময়।**

---

## Files Touched

| File | Change |
|---|---|
| `src/components/admin/AdminSellers.tsx` | + secondary `.order("id", desc)` in query, + sub-label on hero card |
| `src/components/seller/SellerDashboard.tsx` | + secondary `.order("id", desc)` in query, + sub-label on hero card |
| `src/lib/sellerRunningTotal.ts` | `computeDueAdvanceRunning` + `computeRunningTotalsByBank` — secondary sort by `id` after `created_at` |

---

## আপনার জন্য Bangla Note

আপনি যা চাচ্ছেন (per-row running Due/Advance + serial chronological) **আসলে already কাজ করছে** — screenshot-১ এর right-এর `Total (৳)` column-ই সেটা। শুধু একটাই edge issue: একই second-এ multiple txn হলে order unstable হতে পারে। সেটা fix করে দিচ্ছি, এবং hero card-এ একটা small label দিচ্ছি যাতে confusion না হয়। BDT payment গুলো **আলাদা group-এ যাচ্ছে না** — সব chronological সাজানো আছে; আপনি `Apr 22`-এর সব Client Top-Up consecutive দেখছেন কারণ আজ অনেকগুলো auto-approve হয়েছে পরপর।

