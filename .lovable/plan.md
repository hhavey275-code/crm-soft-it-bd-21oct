## Goal

Faisal seller-er **Forwarded** sheet ekhon shudhu payments IN dekhay. Apni chacchen:
1. Ey EBL Skybanking receipt-ta (BDT 38,400, REF 1188006261200122, 30-Apr-2026 11:10 PM, EBL, A/C 301107***7229 — PRANTIK BAJAR) Faisal-er Forwarded entry hisebe archive-e dhukbe.
2. Faisal-er existing **withdraw** entry-gula ar **USDT given** entry-gula Forwarded view-er ek table-ei integrate kore dekhabe (so combined running Due/Adv ek jaygay bojha jay).
3. Final Due/Adv (Forwarded IN − USDT cost − Withdraw) prominently show korbe — eta backend-e already calculated, just UI-te unified table-e visible kore dewa.

## Step 1 — Find Faisal & insert the EBL receipt

- `OldSellerBreakdown.tsx` e ekta admin-only **"➕ Add Forwarded Entry"** button add korbo (Reconciliation card-er moddhe, MigrateForwardedButton-er pashe).
- Click korle ekta dialog open hobe with pre-filled fields:
  - Type: `bdt_payment` (manual entry — Forwarded sheet-e auto-mirror hobe per existing splitBuckets logic line 212-215)
  - BDT Amount: editable (default 38400 jodi current seller Faisal hoy)
  - Date: editable datetime (default 2026-04-30 23:10)
  - Description: editable (default `"EBL Skybanking Transfer · REF: 1188006261200122 · From Acc 118107***1604 → 301107***7229 PRANTIK BAJAR"`)
  - Bank: dropdown of seller-er existing bank_accounts (EBL select kora jabe)
  - Status: `approved`
- Insert into `seller_transactions_archive_2026_05` with seller_id = current selected seller.
- React Query invalidate kore page refresh — receipt immediately Forwarded sheet-e dekhabe ar Due/Adv automatically recalculate hobe.

Eta generic dialog — future-e onno kono receipt o ey button diye add kora jabe, shudhu Faisal-er ey ekta noy.

## Step 2 — Unified Forwarded view (withdraws + USDT inline)

`PaymentsTable` (Forwarded tab) currently shudhu IN rows + ek footer row ("Less: withdrawals") dekhay. Notun behavior:

- Forwarded tab-e **3-section table** korbo (chronologically merged):
  - Payments IN rows (green +amount)
  - USDT given rows (orange −bdt cost, with "X USDT × ৳rate" annotation)
  - Withdraw rows (red −amount)
- Per-row **Running Balance** column add korbo using `computeDueAdvanceRunning` (already exists in `sellerRunningTotal.ts`) — chronological order-e.
- Footer-e summary:
  - Total IN: ৳XX,XXX
  - Less USDT cost: −৳XX,XXX (XX USDT)
  - Less Withdraw: −৳XX,XXX
  - **Final Due/Advance: +৳XX,XXX (Adv) / −৳XX,XXX (Due)** — large bold

Ey way-te apni Forwarded tab-e single chronological ledger dekhben — receipt insert korar pore final number eki jaygay dekha jabe.

## Step 3 — Verify with Faisal

- Plan approve hole ami first dekhbo Faisal-er existing seller_id ki, ar ar koy ta withdraw / USDT entry ase tar archive-e (read-only query)
- Tarpor receipt insert + UI changes apply korbo
- Done hole Faisal-er Forwarded tab-e: existing entries + notun EBL receipt ek list-e, with running balance ar bottom-e final Due/Adv

## Files Touched

- New: `src/components/admin/AddForwardedEntryDialog.tsx` — receipt entry dialog
- Edit: `src/components/admin/OldSellerBreakdown.tsx` — add button + restructure PaymentsTable rendering for Forwarded tab to merge withdraw + USDT rows with running balance

## Non-goals

- Onno seller (Rasel etc.) er existing UI untouched — only PaymentsTable Forwarded tab affected, ar dialog generic.
- Withdraw/USDT physical row-gula archive-e same-i thake; just UI te Forwarded view-tay merged kore dekhano hochhe (Withdraw ar USDT tab-o intact thakbe).
- No DB schema change.
