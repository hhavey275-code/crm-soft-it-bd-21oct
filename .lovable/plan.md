## Goal

Each ad account detail page shows the last-synced billing data (DSL, threshold, balance, cards) to **everyone** (admin + client) along with a clear "Synced X minutes ago" timestamp. A **"Sync now"** button lets users pull fresh data on demand. No background/auto sync.

Two roles, two flows:
- **Admin (extension installed):** Click "Sync now" → extension opens Meta billing page in a hidden tab → scrapes → pushes to CRM → tab closes. Already partially built but currently failing.
- **Client (no extension):** Click "Sync now" → creates a sync request in DB → admin gets notified (Telegram + in-app bell) → admin's extension auto-picks it up and syncs that one account → client sees fresh data on next refresh.

---

## Why current setup fails

`syncSingleAccount` in `extension/background.js` opens the billing tab with `active: false` (background). But Meta's billing SPA often **doesn't fully render / doesn't fire the GraphQL calls when the tab is not visible** — that's why you only see data when you actually open the billing page yourself. The DOM parser then times out and returns "Could not parse billing page".

---

## Plan

### 1. Fix background-tab sync (admin extension)

In `extension/background.js` → `openBillingTab` / `syncSingleAccount`:
- Open tab with `active: false` BUT briefly focus it (`chrome.tabs.update(tab.id, {active:true})`) for ~3s so Meta's SPA renders, then switch back to original tab. This works for admins because their browser is already open. (Alternative: open in a separate minimized window via `chrome.windows.create({ state: "minimized" })` — Meta still renders, user isn't disturbed.)
- Increase wait timeout from 2.5s → 8s.
- After scrape, retry parser up to 3 times with 2s delay if first attempt returns empty.
- Always close the tab in `finally` (already done).

Recommended: use `chrome.windows.create({ focused: false, state: "minimized", url: ... })` — least disruptive, Meta still renders, no user-visible tab flash. Close window when done.

### 2. Show live billing card + sync button on AdAccountDetailPage for ALL roles

Currently `LiveBillingData` + `ExtensionSyncButton` exist but only render for admins. Update `AdAccountDetailPage.tsx`:
- Show `LiveBillingData` card to clients too (read-only).
- Show "Sync now" button to clients too — but with different behavior (see step 3).
- Prominent "Synced X minutes ago" badge (already in `LiveBillingData`).

### 3. Client sync flow (no extension required)

New table `ad_account_sync_requests`:
- `id`, `ad_account_id`, `requested_by` (user id), `requested_at`, `status` (`pending` / `done` / `failed`), `completed_at`, `error`.
- RLS: client can insert request for accounts they own; admin can read/update all.
- Unique partial index on `(ad_account_id) where status='pending'` to dedupe spam clicks.

When client clicks "Sync now":
- Insert row into `ad_account_sync_requests`.
- Toast: "Sync request sent to admin. Data will refresh shortly."
- Send Telegram notification to admin group ("Client X requested billing sync for Account Y — [link]").
- In-app notification bell ping for admins.

### 4. Admin extension picks up pending requests

Add a small poller in `extension/background.js` that, **only when admin opens the extension popup or clicks anywhere in CRM**, calls a new edge function `list-pending-sync-requests` → returns pending request list → extension pops a notification "3 client sync requests pending — click to sync all". Admin clicks → extension iterates one-by-one (with 5s delay between accounts) and runs `syncSingleAccount` on each. On success, marks request `done` via edge function.

No `chrome.alarms` (per your "no auto" requirement) — only triggered when admin interacts with extension/CRM.

### 5. Edge functions

- `request-account-sync` — client calls this; inserts row + sends Telegram.
- `list-pending-sync-requests` — admin extension calls; returns pending list.
- `complete-sync-request` — extension calls after successful sync; marks done.

`ingest-dsl` already exists and works.

### 6. UI polish on AdAccountDetailPage

- Big "Synced 12 min ago" timestamp at top of Live Billing section.
- If data > 1 hour old, show amber "Data may be stale — click Sync now" hint.
- After client clicks sync, button becomes disabled with "Sync requested — waiting for admin…" until row marked done (poll every 10s via React Query).

---

## Files to change

- `extension/background.js` — fix background tab rendering (minimized window approach), retry logic, pending-request poller.
- `src/components/pages/AdAccountDetailPage.tsx` — show LiveBillingData + sync button to all roles.
- `src/components/admin/LiveBillingData.tsx` — role-aware sync button (extension for admin, request for client).
- `src/components/ExtensionSyncButton.tsx` — add a `ClientRequestSyncButton` sibling for non-admins.
- New: `supabase/functions/request-account-sync/index.ts`
- New: `supabase/functions/list-pending-sync-requests/index.ts`
- New: `supabase/functions/complete-sync-request/index.ts`
- DB migration: `ad_account_sync_requests` table + RLS.

---

## What you'll do after I implement

1. Reload the updated extension in `chrome://extensions` (Ctrl+R on the card).
2. Test: from CRM ad account page → click "Sync now" → confirm a tiny minimized Meta window flashes and closes, data refreshes within ~10s.
3. Log in as a client → open same account → click "Sync now" → confirm Telegram notif arrives + button shows "waiting".

Approve and I'll build it.