## Goal

Not-Forwarded sheet e withdraw entries gula chronologically inject korbo (date order e), withdraw rows lal mark thakbe, ar running total prottek withdraw er por update hoye dekhabe — kothon koto Advance/Due chilo.

Seller sheet e kichu kora hobe na (user explicitly bolechen).

---

## Changes — `src/components/admin/OldSellerBreakdown.tsx` only

### 1. `PaymentsTable` component — withdraw rows accept korar capability

**(a)** Notun optional prop add: `withdrawRows?: ArchiveTxn[]`. Forwarded sheet er jonno ei prop pass korbo na (unchanged thakbe). Not-Forwarded sheet er jonno `buckets.withdraws` pass korbo.

**(b)** Sort/running-total logic update — withdraws merge:

```ts
const merged = [
  ...rows.map((r) => ({ row: r, kind: "in" as const })),
  ...(withdrawRows || []).map((r) => ({ row: r, kind: "withdraw" as const })),
].sort(
  (a, b) => new Date(a.row.created_at).getTime() - new Date(b.row.created_at).getTime(),
);

let running = 0;
const withRunning = merged.map(({ row: r, kind }) => {
  const delta = kind === "in" ? r.bdt_amount : -r.bdt_amount;
  const prev = running;
  running += delta;
  return { row: r, kind, prev, after: running, delta };
});
```

**(c)** Render-time changes per row:
- `kind === "withdraw"` hole row class: `bg-rose-500/10 hover:bg-rose-500/15` (lal background, jemon duplicate row).
- Type column e ekta lal "WITHDRAW −" badge.
- "BDT in" column e withdraw er jonno `—` show korbo (in column, withdraw na).
- Notun column ba existing "Change" column: withdraw hole `−৳X,XXX` (lal text), top-up/manual hole `+৳X,XXX` (sobuj — already ase).
- "Running total" column e `formatDueAdvance(after)` style use kore Advance (sobuj) / Due (lal) dekhabo: positive = `+৳X (Adv)` sobuj, negative = `−৳X (Due)` lal, zero = `Settled`.
- Existing `prev`/`after` semantics stable thakbe (carry forward porer rate amount er bhitor).

**(d)** Footer total line update — net total (in − withdraw) dekhabe with Advance/Due label.

**(e)** CSV export e withdraw rows include korbo with sign (negative for withdraw) ar ekta `Kind` column ("payment" / "withdraw").

### 2. Caller site — `<TabsContent value="notForwarded">`

```tsx
<PaymentsTable
  rows={filterRows(buckets.notForwardedIn)}
  forwarded={false}
  withdrawRows={filterRows(buckets.withdraws)}   // NEW
  csvName={`${sellerName}-not-forwarded.csv`}
  duplicateIds={duplicateIds}
  onDelete={(r) => setPendingDelete(r)}
/>
```

Forwarded tab er PaymentsTable e `withdrawRows` pass korbo na — oitar behavior unchanged (only positive in's, jemon ase).

Withdraws tab (existing standalone `WithdrawTable`) — unchanged, intact thakbe extra reference er jonno.

---

## Result — Rasel er Not-Forwarded sheet (preview)

Existing carry: forwarded chara shudhu manual + non-forwarded top-ups. Manual entries forwarded sheet theke mirrored. So ekhane ja running total dekhabe oitai `due.all` er chronological breakdown with withdraws.

Approximate timeline jeta dekhabe (chronological, withdraw sorgula lal):

| Date | Type | In | Out | Running |
|---|---|---:|---:|---:|
| ... March manual + topups | various | +X | — | builds up |
| Apr 9 | **WITHDRAW** | — | **−34,021** | (drops) |
| Apr 12 | **WITHDRAW** | — | **−3,00,000** | (drops more) |
| Apr 18 | **WITHDRAW** | — | **−2,50,000** | |
| Apr 30 | **WITHDRAW** | — | **−2,00,000** | |
| ... May entries | | | | final = +1,22,167.25 Adv |

Final running total existing "All combined Due/Advance" card er sathe match korbe (verification check).

---

## Non-goals

- Seller sheet (production ledger) untouched.
- Forwarded sheet untouched.
- USDT tab, All tab, Top-ups tab — untouched.
- Database e kono change nai — purely UI merge of existing rows.

## Files touched

- `src/components/admin/OldSellerBreakdown.tsx` (only)
