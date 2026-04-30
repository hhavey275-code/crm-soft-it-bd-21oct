## Goal

Confirm previous decisions (hybrid sync, no mass sweep, card remove only on Meta page) AND add a **client-side per-account "Sync" button** next to each account's Daily/Budget limit on the Client Ad Accounts page. Same button works for admin too. Click → extension opens that one account's billing page in a background tab → parses hidden Daily Spending Limit (DSL) + threshold + balance → pushes to CRM → tab closes → UI refreshes.

## Why this is safe

- **User-initiated, one click = one account, one tab.** No automated loops.
- Same flow as opening a Meta page yourself — Meta sees one normal page load per click. No bot-like rapid-fire pattern.
- No `chrome.alarms` periodic scans. No `runBillingSweep` mass loop.

## Changes

### 1. Extension v1.4.2

**`extension/background.js`**
- Remove `runBillingSweep()` and the `chrome.alarms` periodic auto-sync.
- Keep `sync-single-account` message handler (already designed in last plan):
  - Opens `https://adsmanager.facebook.com/ads/manager/account_settings/account_billing/?act={accountId}` as inactive tab
  - Waits for content script ready (poll up to 8s)
  - Sends `collect-billing-snapshot`, receives parsed payload
  - POSTs to `ingest-dsl` edge function
  - Closes tab, returns `{ ok: true, snapshot }` to caller
- Keep opportunistic listener for `push-billing-snapshot` (when user is naturally on a billing page).
- Keep card removal flow (only when active billing tab present).

**`extension/content.js`**
- No change to floating panel or DOM parsing.
- Make sure `collect-billing-snapshot` listener returns the latest snapshot (already wired in v1.4.1).

**`extension/manifest.json`**
- Bump version to `1.4.2`.
- Remove `alarms` permission.
- Add `externally_connectable.matches` for both preview and published CRM domains so client/admin pages can call the extension:
  - `https://*.lovable.app/*`
  - `https://*.lovable.dev/*`
  - Any custom CRM domain already listed.

**`extension/popup.js`**
- Remove "Sync All Accounts" button.
- Show: login status + a one-line note ("Open any ad account billing page or click Sync from CRM").

### 2. CRM UI — Client side (NEW)

**`src/components/client/ClientAdAccounts.tsx`**
- Next to each account row's Budget/limit display (desktop table cell + mobile tile), add a small icon button: `RefreshCw` icon, tooltip "Sync hidden daily limit from Meta".
- Click handler:
  ```ts
  chrome.runtime.sendMessage(EXT_ID, { type: "sync-single-account", accountId: a.account_id }, (res) => { ... })
  ```
- Show inline spinner while in flight; toast success/fail; on success invalidate the `ad_accounts` + `insights` queries so updated DSL appears.
- If `chrome.runtime` undefined → toast: "Install the CRM Sync extension to use this feature" with link to extension download (already on `AdAccountDetailPage`).
- Optional small badge under the limit value showing "Live · {timeAgo}" if `daily_spend_limit_synced_at` exists.

**Read & display DSL in client list (NEW)**
- Extend the client `ad_accounts` query to also fetch `ad_account_last_known_state` (hidden_daily_limit, daily_spend_limit, billing_threshold, daily_spend_limit_synced_at) keyed by account_id.
- In the row, show alongside Budget: "Daily Limit: $X" if hidden_daily_limit available; else "—". This makes the data visible to clients (currently only admins see it via `LiveBillingData`).

### 3. CRM UI — Admin side (from previous plan, kept)

**`src/components/admin/AdminAdAccounts.tsx`**
- Same per-row Sync button (calls same `sync-single-account`).
- "Update All from Meta" button → only refetch from CRM DB (no extension sweep). Tooltip explains: "Use the row Sync button for live Meta data per account."
- Threshold display next to balance (already added in v1.4.1) stays.

**`src/components/admin/LiveBillingData.tsx`**
- Add "Sync from Meta now" button using same `sync-single-account` message.

**`src/components/admin/AdAccountPaymentMethods.tsx`**
- Remove centralized "Remove" button. Replace with note: "Card removal works from the extension panel when you're on the Meta billing page."

### 4. Repackage

`public/dsl-sync-extension.zip` rebuilt with v1.4.2.

## Technical notes

**Sync flow (per click):**
```text
Client/Admin clicks Sync on account row
  → window.chrome.runtime.sendMessage(EXT_ID, { type: "sync-single-account", accountId })
  → background.js: chrome.tabs.create({ url: billingUrl, active: false })
  → poll content.js readiness (max 8s)
  → chrome.tabs.sendMessage(tabId, { type: "collect-billing-snapshot" })
  → content.js parses DOM → returns BillingSnapshot
  → background.js → fetch supabase ingest-dsl with user's auth token
  → chrome.tabs.remove(tabId)
  → callback({ ok: true })
  → CRM toast + queryClient.invalidateQueries(["ad_accounts"]) + ["last_known_state"]
```

**Why no Meta ban concern here:**
- 1 click = 1 tab = 1 page load. Identical to user manually opening that page.
- No background timers. No looping over many accounts. Burden of pacing is on the human clicking.
- If user spam-clicks 20 sync buttons in 5 seconds, we add a small per-account 10s cooldown in `background.js` (in-memory map) to be defensive.

**Files to edit:**
- `extension/background.js`
- `extension/content.js`
- `extension/manifest.json`
- `extension/popup.js`
- `src/components/client/ClientAdAccounts.tsx`
- `src/components/admin/AdminAdAccounts.tsx`
- `src/components/admin/LiveBillingData.tsx`
- `src/components/admin/AdAccountPaymentMethods.tsx`
- `public/dsl-sync-extension.zip` (rebuild)

**No DB changes.** Schema from v1.4.0 already has all needed columns.

## What stays the same

- `ingest-dsl` and `list-managed-accounts` edge functions — no change.
- Opportunistic sync (when you naturally browse a billing page) — works as is.
- Live data auto-refresh in admin detail page — works as is.
- All existing CRM data, queries, RLS — untouched.

## After deploy

User actions:
1. Download v1.4.2 zip from the Ad Account detail page, reinstall (Load unpacked, replace existing).
2. Make sure logged in to Facebook in the same Chrome profile.
3. On Client Ad Accounts page → click the small Sync icon next to any account's Daily Limit → wait ~5-7s → updated DSL appears.
4. Same button available on Admin list and Admin detail page.