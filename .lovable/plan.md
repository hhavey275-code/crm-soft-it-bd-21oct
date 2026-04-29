## Problem

Ad Accounts page e onek account thake. Billing link (External Link icon ar "Old" link) e click korle Facebook billing hub notun tab e khole. CRM e fire ashar por kon account er billing dekhechilen ta mone thake na — sob row dekhte same lage.

## Solution

Last visited billing accounts ke `localStorage` e track kore CRM e visual marker dewa hobe — kono backend / DB change lage na. Per-user, per-browser cache.

### Behavior

1. **Track clicks** — billing icon ("New Billing" ExternalLink) ba "Old" link e click korlei oi `account.id` + click timestamp localStorage e save hobe (max 50 entries, FIFO).

2. **Visual markers on the row** —
   - **Last clicked (most recent)**: account name er pashe ekta highlighted **dot indicator** + thin **left border** in primary color, ar account name er pashe ekta chhoto chip "Last visited • 2m ago".
   - **Recently visited (top 5)**: account name er pashe just ekta soft dot (muted color) + tooltip e "Visited 5m ago".
   - Older than 24h auto expire (visually clear, but stored entry remains until pruned).

3. **"Jump to last visited" shortcut** — page er top control bar e ekta chhoto button: "↩ Last billing: <account name>". Click korle list er moddhe oi row porjonto smooth scroll + brief flash highlight (2 sec).

4. **Manual clear** — small "Clear" link beside the shortcut button to wipe the history if needed.

### Where it applies

- Desktop table view + mobile card view both — `AdminAdAccounts.tsx` ar `ClientAdAccounts.tsx` ey same logic.
- TikTok ad accounts e billing link nai (condition `a.platform !== "tiktok"`), so only Meta accounts will have the marker — natural.

### UX details

- **Marker style** uses semantic tokens (`bg-primary`, `border-primary`, `text-primary`) — matches existing design system, works in both themes.
- **No flicker** — initial state read synchronously from localStorage so on mount the marker is already visible.
- **Cross-tab sync** — `storage` event listener so if billing clicked in tab A, tab B's CRM updates the marker too.

## Technical

**New helper file**: `src/lib/billingVisitTracker.ts`
- `recordBillingVisit(accountId: string, accountName: string)` — push entry, prune to last 50.
- `useBillingVisits()` hook — returns `{ visits: VisitEntry[], lastVisit: VisitEntry | null, recordVisit, clearVisits }` and subscribes to `storage` events.
- `VisitEntry = { accountId: string; accountName: string; visitedAt: number }`
- localStorage key: `crm:billing-visits:v1`.

**Edits**:
- `src/components/admin/AdminAdAccounts.tsx` — wire `onClick` of the two billing `<a>` tags to call `recordBillingVisit(a.id, a.account_name)` (keep `e.stopPropagation()`). Add visit indicator next to account name in both desktop row (line ~995) and mobile card (line ~825). Add the "Jump to last visited" button in the existing toolbar/header area.
- `src/components/client/ClientAdAccounts.tsx` — same treatment.

**Marker component** (inline or `src/components/BillingVisitMarker.tsx`):
```tsx
// Renders: dot + optional "Last visited Xm ago" pill
<BillingVisitMarker visit={visitForThisAccount} isMostRecent={...} />
```

No DB / migration / edge function changes.

## Out of scope

- Persisting across devices (would need DB table). Local-only is enough for the stated workflow.
- Tracking which billing link variant ("New" vs "Old") was clicked — both treated as one visit.