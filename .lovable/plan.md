

## সমস্যা (Diagnosis)

`src/routes/ad-accounts.tsx` (parent listing) এবং `src/routes/ad-accounts.$id.tsx` (detail) — TanStack Router-এর flat-dot convention অনুযায়ী এই দুটো একই prefix share করে, তাই auto-generated `routeTree.gen.ts` (line 905-910) detail route-কে parent route-এর **child** বানিয়ে দিয়েছে।

কিন্তু parent route file `src/routes/ad-accounts.tsx` এর component এ কোনো `<Outlet />` নেই — সরাসরি `<AdAccountsPage />` render করছে। ফলাফল: `/ad-accounts/abc123` URL এ গেলেও listing page-ই render হয়, detail page render-ই হয় না, তাই tap করলে কিছু change হচ্ছে বলে মনে হচ্ছে না (আসলে URL change হচ্ছে, কিন্তু same UI দেখাচ্ছে)।

---

## Fix (1টা ছোট change)

**Option A (recommended, simplest):** `ad-accounts.$id.tsx` route-কে parent থেকে detach করে independent route বানাব। 

TanStack এ এটা করার সবচেয়ে clean উপায় — file rename করে underscore prefix দেওয়া যাতে dot-nesting break হয়। কিন্তু আরও simple পথ হলো parent route file `src/routes/ad-accounts.tsx`-এ একটা special check বসানো:
- যদি current path exactly `/ad-accounts` হয় → `<AdAccountsPage />` render করব
- অন্যথায় (`/ad-accounts/<id>`) → `<Outlet />` render করব যাতে child detail route render হয়

এটা stable, কোনো file rename লাগবে না, route-tree-ও untouched থাকবে।

```tsx
// src/routes/ad-accounts.tsx
import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import AdAccountsPage from "@/components/pages/AdAccountsPage";

function AdAccountsRouteShell() {
  const matches = useMatches();
  // child route /ad-accounts/$id matched হলে only Outlet render করব
  const hasChild = matches.some((m) => m.routeId === "/ad-accounts/$id");
  return (
    <ProtectedGuard>
      {hasChild ? <Outlet /> : <AdAccountsPage />}
    </ProtectedGuard>
  );
}

export const Route = createFileRoute("/ad-accounts")({
  component: AdAccountsRouteShell,
});
```

`src/routes/ad-accounts.$id.tsx` already correct আছে — ওটা untouched থাকবে।

---

## Files Touched

- `src/routes/ad-accounts.tsx` — parent route component update (add Outlet logic)

---

## Test Steps (apply হওয়ার পরে)

আপনি নিচের URLs দিয়ে test করতে পারবেন:

1. **Listing page (আগের মতোই কাজ করবে)**:  
   https://id-preview--6937668f-aa32-4cf4-a1b4-5e3bbd5f53fa.lovable.app/ad-accounts

2. **Detail page direct test** — listing থেকে যেকোনো ad account-এর row/card tap করুন, OR URL bar-এ লিখুন:  
   `https://id-preview--6937668f-aa32-4cf4-a1b4-5e3bbd5f53fa.lovable.app/ad-accounts/<কোনো-account-er-id>`

   Listing-এ যেহেতু কোনো একটা ad account-এ tap করলে navigate call হয় `navigate(`/ad-accounts/${a.id}`)` সেটা থেকে exact ID টা পেয়ে যাবেন — fix-এর পরে detail page open হবে (header metrics, notes, payment methods সহ পুরো page)।

---

## Bangla note

আপনার tap কাজ করছিল ঠিকই, URL-ও change হচ্ছিল, কিন্তু parent page-এ `<Outlet />` না থাকায় detail page render হচ্ছিল না — তাই মনে হচ্ছিল কিছুই হচ্ছে না। উপরের ছোট fix-টা apply করলে immediately কাজ করবে, এবং আপনি direct URL-এ গিয়েও detail page দেখতে পারবেন।

