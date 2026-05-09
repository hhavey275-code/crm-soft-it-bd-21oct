## Goals

1. **Manual card details (brand/bank/label/holder/notes) must NOT be wiped** when the extension re-syncs an ad account. update 
2. **Ad-account list table** should show only **one card per account** — the default (primary) card from the Meta API, exactly like before.
3. **Default card always comes from the live API**. Synced/extra cards may optionally be listed under the default, but the default itself is API-driven.

## Root causes (found while exploring)

**Issue #1 — Manual card details disappear after sync:**
`supabase/functions/ingest-dsl/index.ts` (line 107–116) upserts `ad_account_cards` with `card_type: card.type ?? null`. Extension rarely captures the brand from FB's API, so it sends `null`/`""` — the upsert overwrites the admin's manually-set brand back to `null`. Other manual fields (`admin_label`, `bank_name`, `holder_name`, `notes`) are not in the payload so they survive — only `card_type` is being clobbered.

**Issue #2/#3 — Multiple cards in list:**
`src/components/admin/AdminAdAccounts.tsx` (line 1184–1190) maps over `ins.cards` and renders all of them. Previously it rendered only the first/default card.

## Changes

### 1. `supabase/functions/ingest-dsl/index.ts` — preserve manual `card_type`

Inside the `for (const card of cards)` upsert loop (around line 107):

- Build the payload conditionally: only include `card_type` when `card.type` is truthy.
- This way Postgres `ON CONFLICT DO UPDATE` won't touch the column when the extension has nothing better to offer, so the admin's saved brand stays intact.
- Same defensive treatment for `exp_month` / `exp_year` (skip when null) so manually-corrected expiry isn't wiped either.

No schema change needed.

### 2. `src/components/admin/AdminAdAccounts.tsx` — show only the default card

Replace the multi-card map (line 1184–1190) with single-card rendering:

- Pick the default card: `const defaultCard = ins?.cards?.find((c: any) => c.is_primary) ?? ins?.cards?.[0];`
- Render just that card's `CardBrandIcon` + `display_string`.
- If `ins.cards.length > 1`, append a tiny muted `+N` chip (e.g. "+2 more") so the admin still knows extras exist — clicking through to the ad-account detail page reveals them in the existing Payment Methods card. (If you'd rather hide the chip entirely, say so and I'll drop it.)

### 3. (Optional) `src/components/admin/AdAccountPaymentMethods.tsx` — order by default first

Already shows multiple cards on the detail page. Make sure the default (primary, from API) is rendered first and labeled "Default", with synced extras listed below — this matches your point #3 ("default card always from API, synced cards under it"). Current ordering uses cached extension order; switch to: API-default first, then any other cached cards.

## Out of scope

- Edit dialog UI (already has Brand + Bank fields from the previous turn — keeping it as-is).
- Extension code (no change needed; the server-side fix protects manual data regardless of what the extension sends).
- Database migration (none required).

## Verification

- Edit a card → set brand to Visa + bank "DBBL" → save.
- Trigger an extension sync.
- Re-open the ad account → brand and bank still present.
- Open the admin ad-account list → each row shows exactly one card (the API default), matching the pre-change look.