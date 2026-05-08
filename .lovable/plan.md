## Goal

Ad account er **default + backup card er last-4 digit** CRM e reliably store thakbe, jate account access hariye gele card identify kore Meta support / bank theke action neya jay. Background-er invisible auto-sync (ja Meta throttle kore) chere diye, **passive content-script capture** model use korbo (Smit-style).

## Current state (already in place)

- `extension/content.js` already Meta billing page e DOM + GraphQL theke cards, last-4, brand, default flag scrape kore.
- `supabase/functions/ingest-dsl` already cards `ad_account_cards` + `ad_account_payment_snapshots` table e store kore (with `is_primary` flag).
- Background `auto-sync` (invisible window) Meta er throttling er karone unreliable — eta drop korbo.
- CRM-side card display section ager turn e remove kora hoyeche — etake **read-only recovery view** hisebe firiye anbo.

## Plan

### 1. Extension — lean into passive capture (v2.3.0)

**File: `extension/content.js`**
- Billing page e user visit korlei (already DOM + GraphQL parse hocche) — snapshot ready hole **automatically push** kore CRM e (debounced, 1 push per account per session).
- "Sync to CRM" button thakbe manual override hisebe.
- Default + backup detection sharpen: GraphQL response e `is_primary` / `is_default` / `default_method` field er sathe DOM "Default" / "Backup" label cross-check.

**File: `extension/background.js`**
- Scheduled mass auto-sync (`runAutoSync` + alarm) **disable** kore dilam (Meta detection-safe + reliability problem).
- Per-account on-demand sync (`syncSingleAccount`) thakbe — admin manually trigger korle kaj korbe.
- Pending sync request poller thakbe (jokhon client request kore).

**File: `extension/manifest.json`**
- Version → `2.3.0`, description update.

### 2. CRM — card recovery panel (read-only)

**File: new `src/components/admin/AdAccountCardsPanel.tsx`**
- `ad_account_cards` table theke read kore tabular display:
  - Brand icon (Visa/MC/Amex via existing `CardBrandIcon`)
  - `•••• 1234` (last-4)
  - `Default` / `Backup` badge
  - Expiry (MM/YY) jodi store thake
  - Last synced relative time
- Empty state: "No card data synced yet — open the account on Meta Billing page with the extension installed."

**File: `src/components/pages/AdAccountDetailPage.tsx`**
- Ager removal er jaygay (line ~577) ekta compact `AdAccountCardsPanel` add korbo — **shudhu cards**, DSL/Live Billing add korbo na (ja extension-unreliable chilo).
- Heading: "Cards on file (for account recovery)" + small note "Synced from Meta Ads Billing via extension. Used to identify cards if account access is lost."

### 3. Extension zip rebuild

- `public/dsl-sync-extension.zip` regenerate (bump version reference in `AdAccountDetailPage` `EXTENSION_VERSION` constant from `2.1.0` → `2.3.0`).

## Out of scope (will not touch)

- Top-up verify, payment forwarding, Stripe webhook, tenant ledger, sheet-sync (locked flows per `CRITICAL_LOCKED_FUNCTIONS.md`).
- DSL / Live Billing display (deliberately removed last turn — extension data unreliable for those).
- Card *removal* mutation flow in extension (already works, untouched).

## Technical notes

- **No DB migration needed** — `ad_account_cards` table already exists with `last_four_digits`, `brand`, `is_primary`, `expires` columns (used by `ingest-dsl`).
- **No new edge function** — reusing `ingest-dsl`.
- **Auto-push debounce**: in content.js, after `rebuildSnapshot()` populates ≥1 card with real GraphQL id, fire `pushBillingSnapshot` once per `account_id` per page load (track via `state.lastSyncedKey`).
- **Privacy**: only last-4 + brand + expiry stored — never full PAN, CVV, or cardholder name. (Already true; calling out explicitly.)

## Files to change

1. `extension/manifest.json` — version bump
2. `extension/content.js` — auto-push on snapshot ready
3. `extension/background.js` — remove scheduled alarm, keep on-demand
4. `src/components/admin/AdAccountCardsPanel.tsx` — new component
5. `src/components/pages/AdAccountDetailPage.tsx` — mount the panel
6. `public/dsl-sync-extension.zip` — rebuild
