## Problems found

1. **Proof duibar forward hocche** — `top_up_requests` table-e duto trigger same kaaj kortese, dujone-i `forward-proof` ke call kore approval-er somoy:
   - `sync_seller_transaction_for_approved_topup_trigger` (AFTER INSERT OR UPDATE — kono WHEN clause nai, jekono update-eo fire kore)
   - `sync_seller_txn_on_topup_approve` (AFTER INSERT OR UPDATE OF status WHEN status='approved')
   
   Dujone milliseconds-er moddhe fire kore. `telegram_forward_log`-er unique index ekta-ke block kortese kintu race window-e dujone-i dedupe check pass kore Telegram-e photo POST kore dey — duibar message ashe.
   
   Same problem `seller_transactions`-eo: `trg_purge_rejected_seller_txn`, `trg_purge_rejected_seller_txn_ins`, `trg_purge_rejected_seller_txn_upd` — tinta trigger ekoi kaj kore.

2. **Sheet-e total balance update hocche na** — `seller_sheet_config` table-e `col_total` ar `col_due_adv` column ache (sheet-er Total cell-er address rakhar jonno), kintu `sync-seller-to-sheet` edge function-er `buildCellsForTxn` ei column-e KICHU lekhe na. Proti row-er BDT/USDT/Rate likhche, kintu running Due/Advance balance kothao jachhe na. Ei karon-e admin sheet-e shudhu individual amounts dekhe, total balance update hoy na.

3. **Forward er moddhe atomic lock nai** — `checkForwardLog` shudhu read; insert hoy Telegram POST-er pore. Du-ta concurrent invocation dujone-i "not forwarded" dekhe duibar pathay. Dedupe row pore likha hoy bole second POST block hoy na — shudhu second log-write fail hoy.

## Fix plan

### A. Database migration — duplicate triggers drop + atomic forward lock

1. **Drop duplicate triggers on `top_up_requests`:**
   - DROP `sync_seller_transaction_for_approved_topup_trigger` (the one without WHEN clause)
   - Keep ONLY `sync_seller_txn_on_topup_approve` (status='approved' guarded)
   
2. **Drop duplicate triggers on `seller_transactions`:**
   - DROP `trg_purge_rejected_seller_txn` and `trg_purge_rejected_seller_txn_ins`
   - Keep ONLY `trg_purge_rejected_seller_txn_upd`
   
3. **Add atomic-claim helper RPC `claim_forward_slot(source_type, source_id)`:**
   - Inserts into `telegram_forward_log` with placeholder values BEFORE the Telegram call
   - Returns `true` if this caller "won" the slot, `false` if a row already existed
   - Uses `INSERT … ON CONFLICT DO NOTHING RETURNING 1` so it's race-safe at the SQL level
   - Subsequent edge function fills in `telegram_message_id` + `caption_total_bdt` after successful POST

### B. Edge function `forward-proof` & `forward-seller-proof` — switch to atomic claim

Replace the `checkForwardLog` (read-then-insert) pattern with `claim_forward_slot` RPC call:
- If claim returns `false` → already-forwarded, skip Telegram POST entirely
- If claim returns `true` → POST to Telegram, then UPDATE the log row with message_id + balance
- This guarantees AT MOST ONE Telegram message per `(source_type, source_id)` even under heavy concurrency

### C. Edge function `sync-seller-to-sheet` — write running balance

In `buildCellsForTxn`, after writing the per-row amounts, also compute the running Due/Advance balance up to and including this txn (using the same `computeDueAdvance` logic from `_shared/seller-balance.ts`) and write it into:
- `cfg.col_total` cell (running BDT balance with sign)
- `cfg.col_due_adv` cell ("Due ৳X" or "Advance ৳X" formatted string)

Since the function already loops through `pending` txns in chronological order with an advisory lock, we accumulate the running total per row inline. Each row gets the snapshot balance as of that row's timestamp — exactly matching what Telegram caption shows.

### D. Verify chronological order is preserved

Already implemented in the previous round (advisory lock + sorted batch append), no changes needed. But confirm: when admin approves an old top-up after a newer USDT, the sync function fetches ALL unsynced approved txns for the month and appends them in `created_at` order — older entries always get earlier rows. ✓

## Files to change

- New migration: drop duplicate triggers + add `claim_forward_slot` RPC
- `supabase/functions/forward-proof/index.ts` — use claim RPC
- `supabase/functions/forward-seller-proof/index.ts` — use claim RPC
- `supabase/functions/sync-seller-to-sheet/index.ts` — write running balance into `col_total` / `col_due_adv`
- `supabase/functions/_shared/seller-balance.ts` — add `claimForwardSlot()` helper

## Expected behavior after fix

- **Top-up approve** → exactly one Telegram message + sheet row appears in chronological order with correct running Total
- **USDT approve (with or without proof)** → exactly one Telegram message (photo if proof, text-only otherwise) + sheet row + running Total cell updates
- **Withdraw entry** → same as above
- Sheet-e proti row-er pashe Total column-e accurate Due/Advance balance dekhabe, jeta proti notun entry-te update hobe
- Telegram caption-er Total ar sheet-er Total column ekoi value dekhabe (same source: `computeDueAdvance`)
