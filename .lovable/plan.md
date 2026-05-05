# Plan: Make all pages load faster (target: instant nav)

## Diagnosis (kothay slow hocche)

Ami sob route + boro page file inspect korechi. Main bottlenecks:

1. **Code-splitting nei** — sob route file directly `import` korche giant page components:
   - `ClientDetailPage` = **3,181 lines**
   - `TenantDetailPage` = **1,350 lines**
   - `AdAccountDetailPage` = **1,154 lines**
   - `AgencyDetailPage` = **1,011 lines**
   - `BillingsPage` = **444 lines**
   
   Eta sob ekta main JS bundle e dhuke jay. Initial load e browser ke ~10k+ lines parse korte hoy — tai first paint slow.

2. **Dashboard route eager-loads 4 dashboards** — `AdminDashboard`, `ClientDashboard`, `SellerDashboard`, `AgencyDashboard` — kintu user matro 1ta dekhe. 75% code waste.

3. **TechBackground canvas** ekhon lazy holeo prottek page e animation 60fps e cholche (requestAnimationFrame loop with 35 particles + hex grid). Background tab eo CPU khay → page interaction laggy mone hoy.

4. **Router preload disabled** — `defaultPreloadStaleTime: 0` ar kothao `<Link preload="intent">` use hocche na. Mouse hover korle next page prefetch hoy na.

5. **Kichu query er staleTime kom / 0** — ClientTopUp, ClientDashboard er ekta query, etc. — page e dhukle bar bar refetch.

## Plan

### 1. Lazy-load all heavy page components (biggest win)

`src/routes/*.tsx` er moddhe ja directly boro page import korche, segulo `React.lazy` + `Suspense` diye convert korbo. Affected routes:
- `clients.$id.tsx` → ClientDetailPage
- `tenants.$id.tsx` → TenantDetailPage
- `ad-accounts.$id.tsx` → AdAccountDetailPage
- `agencies.$id.tsx` → AgencyDetailPage
- `billings.tsx`, `system-logs.tsx`, `card-vault.tsx`, `invoice.$requestId.tsx`, `client-spend-report.tsx`, `admin.performance.tsx`, `admin.stripe-links.tsx`, `my-unused.tsx`, `wallet-balances.tsx`, `ads-manager.$accountId.tsx`, `meta-oauth-callback.tsx`, `agency-*`, `tenants.index.tsx`, `clients.index.tsx`, etc.

Pattern:
```tsx
const ClientDetailPage = lazy(() => import("@/components/pages/ClientDetailPage"));
// in route component:
<Suspense fallback={<PageSkeleton />}> <ClientDetailPage /> </Suspense>
```

Ekta shared `PageSkeleton` component banabo (simple shimmer) jate fallback e blank na dekhay.

### 2. Lazy-load role dashboards

`src/routes/dashboard.tsx` e Admin/Client/Seller/Agency dashboard lazy korbo, role detect korar por only relevant ta load hobe.

### 3. Tame TechBackground

- Render only after `requestIdleCallback` (mount er por 1s deri).
- Pause animation jokhon `document.hidden` (tab background e gele).
- Mobile (`< 768px`) e disable kore dibo — choto screen e ei effect dekhao jay na, sudhu battery khay.

### 4. Enable router prefetching

`src/router.tsx` e `defaultPreload: "intent"` + `defaultPreloadStaleTime: 30_000` set korbo. Sidebar er link e hover korle next page prefetch hobe → click korle instant.

### 5. Tighten cache for common queries

- `ClientTopUp.tsx`: `staleTime: 0` → `60_000`.
- `ClientDashboard.tsx` er last query (staleTime 0) → `30_000`.
- `useSiteSettings` (header logo/announcement) — `staleTime: Infinity` (page e bar bar refetch korar dorkar nei).

### 6. Vite manual chunks (optional polish)

`vite.config.ts` e manualChunks diye `react`, `@tanstack`, `recharts`, `lucide-react` alada vendor chunk e bhag korbo — initial parse choto hobe ar long-term browser cache better hobe.

## Expected impact

- Initial JS bundle ~40-60% choto hobe (ClientDetailPage etc. nijer chunk e jabe).
- Dashboard route load: 4x → 1x (sudhu nijer role).
- Subsequent navigation: hover prefetch er karone almost instant.
- TechBackground CPU usage mobile e 0%, desktop e idle tab e 0%.

## Files to change

- `src/router.tsx` (preload config)
- `src/routes/dashboard.tsx`, `clients.$id.tsx`, `tenants.$id.tsx`, `ad-accounts.$id.tsx`, `agencies.$id.tsx`, ar onnano detail/heavy route file
- `src/components/DashboardLayout.tsx` (TechBackground gating)
- `src/components/TechBackground.tsx` (visibility pause)
- `src/components/PageSkeleton.tsx` (new)
- `src/hooks/useSiteSettings.ts` (staleTime)
- `src/components/client/ClientTopUp.tsx`, `ClientDashboard.tsx` (staleTime tweak)
- `vite.config.ts` (manualChunks)

Approve korle implement kore dibo — kono backend / DB change nei, sudhu frontend perf.
