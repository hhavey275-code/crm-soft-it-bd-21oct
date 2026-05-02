## সমস্যা

আগের fix এ আমি `telegram_forwarded = NULL` কে "forwarded" ধরেছিলাম, যার ফলে Forwarded sheet এ এমন সব পুরোনো top-ups চলে এসেছে যেগুলো actually Telegram এ forward হয়নি (12,700 / 14,000 / 30,000 ইত্যাদি — screenshot এ দেখা যাচ্ছে)। User এর rule:

- **Forwarded sheet** = শুধু সেগুলো যেগুলো actually forward হয়েছে
- **jegula forword hoy ne segula not forworded e niye jao** 
- **DCV6NSLQ6M (6,500 · 31 Mar)** ও **DD19P4W5U3 (6,500 · 1 Apr)** — Telegram এ forward হয়েছিল কিন্তু DB এর `telegram_forwarded` flag set হয়নি, তাই এদের manually forwarded ধরতে হবে

## পরিবর্তন

### 1. `src/lib/oldSellerData.ts`

**(a)** ফাইলের উপরে একটা override set যোগ করা:

```ts
// Top-up requests that were actually forwarded to Telegram but whose
// `telegram_forwarded` flag was never persisted (legacy rows). Treat these
// as forwarded for the archive audit view.
const FORCE_FORWARDED_TOPUP_IDS = new Set<string>([
  "a8788536-839d-4d10-be20-d5f5f76fa2cc", // DCV6NSLQ6M · Rasel · 31 Mar 2026
  "35777582-cd93-4324-8ad0-ee1d2e1dbe9d", // DD19P4W5U3 · Rasel · 1 Apr 2026
]);
```

**(b)** `topup_forwarded` mapping এ কঠোর rule:

```ts
topup_forwarded: tu
  ? (tu.telegram_forwarded === true || FORCE_FORWARDED_TOPUP_IDS.has(tu.id))
  : null,
```

NULL বা false → আর forwarded ধরা হবে না।

**(c)** `splitBuckets` এ rule আপডেট — non-forwarded top-up কোথাও যাবে না:

```ts
if (t.type === "client_topup") {
  // Only forwarded top-ups appear (in Forwarded sheet).
  // Non-forwarded top-ups are intentionally hidden from BOTH sheets.
  if (t.topup_forwarded === true) forwardedIn.push(t);
} else if (MANUAL_TYPES.has(t.type)) {
  // Manual entries continue to mirror in both sheets.
  forwardedIn.push(t);
  notForwardedIn.push(t);
}
```

### 2. `src/components/admin/OldSellerBreakdown.tsx`

Reconciliation card এ যেহেতু এখন non-forwarded top-ups কোথাও দেখানো হচ্ছে না, একটা info note যোগ করা যে কতগুলো top-up hidden আছে (আগের orphan top-up panel এর মতো — ইতিমধ্যে আছে কিনা চেক করে আপডেট করা)।

## ফলাফল (Rasel এর জন্য)

Forwarded sheet এ থাকবে শুধু:

- **DCV6NSLQ6M** — 6,500 BDT (31 Mar)
- **DD19P4W5U3** — 6,500 BDT (1 Apr)
- 82,400 manual entry
- বাকি সব manual entries

Forwarded sheet থেকে সরে যাবে: 12,700 / 6,500 (23 Mar) / 14,000 / 30,000 / 6,500 (27 Mar) / 4,900 / 6,500 (28 Mar) / 6,500 (29 Mar) / 14,000 (31 Mar) — এগুলো কোনো sheet এ থাকবে না।

ভবিষ্যতে যদি আরও legacy top-up পাওয়া যায় যেগুলো actually forward হয়েছিল কিন্তু flag missing, শুধু `FORCE_FORWARDED_TOPUP_IDS` set এ ID যোগ করতে হবে।