

## ৪টা Update — Plan

### 1. Google Sign-In on Auth Page
`src/components/AuthForm.tsx`-এ "Continue with Google" button add করব (login + signup দুটোতেই, divider সহ):
```ts
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${window.location.origin}/dashboard` },
});
```
**আপনাকে যা করতে হবে:** Supabase Dashboard → Authentication → Providers → **Google enable** করতে হবে (Client ID + Secret সহ)। আমি একটা link দেব।

### 2. Seller Dashboard থেকে Graph + Recent Activity Remove
`src/components/seller/SellerDashboard.tsx` line 467-468 থেকে `<BalanceHistoryChart />` remove করব। `BalanceHistoryChart.tsx` file-টাও delete করব। Calculation, totals, ledger — সব intact থাকবে।

### 3. Telegram Forward — Due/Advance Total Confirm
`supabase/functions/forward-seller-proof/index.ts` already এই কাজ করছে (line 96-122):
- `seller_transactions` থেকে seller-এর সব approved txn fetch করে
- `computeDueAdvance()` দিয়ে running balance বের করে
- Caption-এ append করে: `🟢 Total: Advance +৳X` বা `🔴 Total: Due −৳X`

**Action:** Code review confirm করেছি এটা কাজ করছে। আমি একটা test invoke করে verify করব forward হচ্ছে কিনা — যদি কোনো bug দেখা যায়, fix করব। কোনো নতুন code change লাগবে না (সম্ভবত)।

### 4. "System Update" Button (Cache Clear)
`src/components/AppSidebar.tsx`-এ profile area-র কাছে একটা **"Update System"** button add করব। Click করলে:
- `caches.keys()` → সব service worker cache delete
- `localStorage` থেকে non-auth keys clear (auth session preserve)
- `sessionStorage.clear()`
- Service worker unregister + re-register
- Toast: "✅ Update applied! Reloading..." → 1.5s পরে hard reload (`window.location.reload()`)

Toast/banner-এ একটা subtle hint থাকবে dashboard-এ যখন নতুন update detect হয়।

### 5. Admin Menu Permissions — Missing Menus Add
`src/components/admin/AdminClients.tsx`-এর `ALL_MENU_KEYS` array (line 25-44) outdated। Sidebar-এর `adminNavItems`-এ এই menu গুলো আছে কিন্তু `ALL_MENU_KEYS`-এ নেই:
- `feedback` (Feedback)
- `announcements` (Announcements)
- `admin-performance` (Admin Performance)
- `card-vault` (Card Vault)

**Fix:** Sync করব দুই list — `ALL_MENU_KEYS` এ এই 4টা add করব। তাহলে superadmin admin-কে role assign করার সময় সব menu visible হবে।

---

## Files Touched

| File | Change |
|---|---|
| `src/components/AuthForm.tsx` | + Google sign-in button + divider |
| `src/components/seller/SellerDashboard.tsx` | − BalanceHistoryChart import + render |
| `src/components/seller/BalanceHistoryChart.tsx` | 🗑 delete |
| `src/components/admin/AdminClients.tsx` | `ALL_MENU_KEYS` array-এ 4টা missing menu add |
| `src/components/AppSidebar.tsx` | + "Update System" button + cache-clear handler |
| `supabase/functions/forward-seller-proof/index.ts` | Verify only — likely no change |

---

## আপনার জন্য Step (Google Sign-In Enable)

কাজ apply হওয়ার পরে Google sign-in কাজ করতে হলে **Supabase Dashboard-এ Google provider enable** করতে হবে — একটা link দেব Authentication → Providers page-এ।

