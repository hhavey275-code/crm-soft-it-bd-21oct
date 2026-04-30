## Goal

Billing page e injected "Ads Check by CRM" panel ta aro boro/readable korbo, ar Total Spending row ta keno khali astese seta thik korbo. Ekta minor extension update (v1.4.3) — CRM UI te kono change nei.

## Problem analysis

**1. Panel choto dekhay**
`extension/content.js` e panel currently:
- width: `320px`
- maxHeight: `80vh`
- fontSize: `12px`, header `13px`
- row padding: `5px 0`

Mobile/zoomed Meta billing page e eta khub compressed lage.

**2. Total spending data asche na**
Current parser:
```js
const totalSpending = findAfter("Total spending");
```
Kintu Meta billing page e ei value ta usually label hoy **"Amount spent"**, **"Total amount spent"**, **"Spent"**, ba **"Spent this month"** — "Total spending" string ta beshirvag account e thakey na, tai always `null` astese. SMIT panel e jeta dekhay seta o "Amount spent" theke parse kora.

## Changes (only `extension/content.js` + `manifest.json` version bump + repackage zip)

### A. Bigger, more readable panel
In `ensurePanel()` style block:
- `width: "420px"` (320 → 420)
- `maxHeight: "85vh"`
- `fontSize: "13px"` (12 → 13), `lineHeight: "1.5"`
- Header title `font-size: 15px`, header padding `12px 14px`
- Body padding `12px 14px`
- Row padding `7px 0`, label `font-size: 12px`, value `font-size: 13px`
- Sync/collapse buttons `padding: 6px 10px; font-size: 12px`
- Card rows: padding `8px 10px`, card name `font-size: 13px`

Panel position unchanged (top:80px, right:16px) so it doesn't cover Meta's main column.

### B. Fix Total Spending parsing
Replace single line with cascading fallbacks:
```js
const totalSpending =
  findAfter("Total amount spent") ||
  findAfter("Amount spent") ||
  findAfter("Total spending") ||
  findAfter("Spent this month") ||
  findAfter("\\bSpent\\b", { regex: true });
```
This matches whatever Meta's locale/layout currently uses. The existing `findAfter` regex already tolerates currency prefixes and 80 chars of whitespace between label and value.

Also tighten the `findAfter` to skip matches where the captured number is suspiciously a date (e.g. matches "2024" alone). Add a minimum-context check: if the matched line contains "ago" or pure year-only, return null. Keep simple — only reject if `raw` is exactly `\d{4}` with no decimal/comma/currency.

### C. Version bump + repackage
- `extension/manifest.json`: `"version": "1.4.3"`
- Repackage `extension/` → `public/dsl-sync-extension.zip` via `nix run nixpkgs#zip`.

## What stays the same
- CRM UI (no changes to AdminAdAccounts, ClientAdAccounts, LiveBillingData)
- Background sync logic, hybrid model, cooldown
- Card removal flow (still only on Meta billing page)
- DB schema, edge functions

## User action after deploy
Reinstall extension v1.4.3 from CRM download button (chrome://extensions → remove old → Load unpacked new folder, ba zip refresh).

## Files touched
- `extension/content.js` — panel sizing + total-spending fallbacks
- `extension/manifest.json` — version 1.4.3
- `public/dsl-sync-extension.zip` — repackaged
