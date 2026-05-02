# Per-Seller Google Sheet Sync + Total Bug Fix + USDT/Withdraw Forwarding

Apni sheet design + cell mapping dibe. Ami backend ready korbo.

---

## Part 1 — Wrong Total Bug Fix (HIGHEST PRIORITY)

**Screenshot e dekhlam:**
- Top message (Murtada, ৳1,29,010 top-up): Total = **+৳62,67,767**
- Bottom message (Md Rakib, ৳3,810 top-up — newer): Total = **+৳61,46,377** ❌

Notun ৳3,810 add hole total **barano** uchit, **kome** gelo. ৳1,29,010 - ৳3,810 = ৳1,25,200 difference — basically nicher ta uporer ta ke count koreni.

**Root cause:**
`forward-proof` (client top-up function, line 124-130) e:
```ts
const { data: txns } = await supabase.from('seller_transactions')...eq('seller_id', sellerId);
let balance = computeDueAdvance(txns);
balance += Number(reqData.bdt_amount || 0);   // adds THIS pending top-up
```

Problem: `seller_transactions` query e **default 1000 row limit**. Najmul er already 1000+ row ache. Jodi puratan bdt_payment / usdt_received row truncate hoy → balance wrong. Abar ekই moment e 2 ta forward race korle dujon ekই snapshot dekhe — 2nd jon 1st joner pending value miss kore.

**Fix:**
1. **Pagination** in balance compute (1000 row safe).
2. **Pending top-ups o include** korbo: `top_up_requests` theke `status='approved' AND telegram_forwarded=true` rows jegula `seller_transactions` e ekhono insert hoy nai — segula o balance e jog korbo (verify-topup async run hoy, race hoy).
3. **Verify after compute**: jodi computed balance previous Telegram message er forwarded total er cheye kom hoy + current entry IN type → flag ar correct kore pathabo (warning log).
4. **Always atomic**: balance compute + Telegram send + log insert ek transaction-like flow — rollback on partial fail.

---

## Part 2 — USDT Given / Withdraw o Telegram e Forward (with new total)

**Ekhon ki hoy:**
- USDT given: approval er por shudhu forward hoy jodi proof_url thake. Withdraw: kichui forward hoy na.
- Total kombe but operator dekhbe kothao na — tai confusion.

**Notun behavior:**
Prottek bar balance change hole (BDT in / USDT given / withdraw / top-up approved / manual entry) → **automatic Telegram forward** seller er primary group e:

```
🔻 USDT Given
👤 Najmul Hossen
💲 5,000 USDT × ৳127 = ৳6,35,000
🔖 Ref: TRX12345
🔴 Total: Due −৳5,28,623   ← Previous Advance ৳1,06,377 - ৳6,35,000

[proof image attached]
```

```
🔻 Withdraw
👤 Najmul Hossen
💰 ৳50,000
📝 Cash withdrawn for office
🔴 Total: Due −৳5,78,623

(no proof — text only message)
```

- Withdraw e jodi proof na thake → `sendMessage` (text), proof thakle `sendPhoto`.
- USDT/withdraw forward o `telegram_forward_log` e idempotency lock e jabe (Part 4).

---

## Part 3 — Per-Seller Google Sheet Sync (Apni Design Korben)

### Setup (one-time per seller)
Settings page e per-seller config:
```
Seller: Najmul Hossen
  Spreadsheet URL: [paste link]
  Worksheet name pattern: [e.g. "{YYYY-MM}" → auto creates "2026-05" tab each month]
  Enable sync: [✓]
```

### Cell mapping (apni dibe)
Apni ekta sheet ready koren (header row + jekhane ja boshbe). Ami ekta config file e mapping store korbo:

```yaml
# Example — apni adjust korben after dekhe
seller_id: e5670168...
columns:
  date: A
  time: B
  type: C            # "TopUp" / "USDT" / "Withdraw" / "BDT"
  amount_bdt: D
  amount_usd: E
  rate: F
  bank: G
  client_name: H
  ref: I
  proof_link: J
  running_balance: K
  txn_id: L          # hidden — used for dedupe
header_row: 1
data_starts_row: 2
```

Apni screenshot ba sheet link dile ami dekhe ei mapping likhe debo.

### Month rotation
- Worksheet name pattern e `{YYYY-MM}` → notun month start hote auto `addSheet` API call hobe.
- Header row auto copy from template tab (apni "TEMPLATE" naam e ekta tab rakhben — ami clone korbo).
- Apni current month e ele direct oi tab e new entries pacchen.

### Sync flow
1. Notun seller_transaction insert OR top_up_request approved → app code `sync-to-sheet` edge function call (fire-and-forget).
2. Function: get spreadsheet_id from config → ensure month tab exists (create if not) → append row using mapping.
3. **Idempotent**: txn_id column e duplicate check before append.
4. **Failure queue**: fail hole `sheet_sync_queue` table e push, cron 5 min e retry.
5. **Backfill button**: "Sync from date" — apni puratan data ek bar push korte parben.

---

## Part 4 — Forward Dedupe (durable lock)

`telegram_forward_log` table:
```text
id | source_type | source_id | telegram_message_id | forwarded_at
UNIQUE (source_type, source_id)
```

`forward-proof` + `forward-seller-proof` dujon e:
- **Pre-check**: row ache? → skip, return existing message_id.
- **Post-success**: insert log + mirror flag.

Tai retry / double-click / network glitch e duplicate Telegram message ar jabe na.

---

## Implementation Order

1. **Total bug fix** (Part 1) — pagination + pending include + verify. Highest priority.
2. **USDT/Withdraw forward** (Part 2) — new total in caption.
3. **Forward dedupe log** (Part 4) — durable lock.
4. **Sheet config tables + per-seller settings UI** (Part 3 setup).
5. **Sync edge function** with month auto-rotate + cell mapping engine.
6. **Backfill button** — push past data.

## Technical Details

- **Migrations**:
  - `telegram_forward_log` table + RLS + unique index.
  - `seller_sheet_config` table (seller_id, spreadsheet_id, tab_pattern, column_mapping jsonb, enabled).
  - `sheet_sync_queue` table (id, seller_id, payload jsonb, retry_count, last_error, next_retry_at).
- **Edit `forward-proof`**: pagination, pending include, dedupe pre-check, log insert.
- **Edit `forward-seller-proof`**: same fixes + extend to handle `withdraw` type (currently shudhu bdt_payment / usdt_received).
- **Caller updates**: `AdminSellers.tsx` withdraw insert path → call forward function.
- **New edge function** `sync-to-sheet`:
  - Uses Google Sheets connector gateway (`https://connector-gateway.lovable.dev/google_sheets/v4`).
  - Logic: fetch spreadsheet metadata → check tab → `addSheet` if missing → `values.append` with mapped row.
- **New page** `/seller-sheet-config` (admin only): per-seller config UI.
- **Cron**: pg_cron call `sync-to-sheet-retry` every 5 min for queued items.

## Out of Scope
- Two-way sync (sheet edit → DB).
- Editing past Telegram messages with corrected totals.
- One mega spreadsheet for all sellers (per-seller alada per your request).

---

**Approve korle ami:**

1. Part 1 + 2 + 4 (bug fix + USDT/withdraw forward + dedupe) **ekhon-i** build korbo — eta apnar Telegram immediately fix korbe.
2. Part 3 er jonno Google Sheets connector connect prompt dibo — apni connect korben.
3. Tarpor apni:
   - Per-seller sheet link dibe (template tab soho)
   - Cell mapping bolben (ki column e ki boshbe)
4. Ami mapping config save kore sync activate kore dibo.

**Confirm korben:**
- Withdraw forward ki **shob seller** er jonno auto, naki per-seller toggle?
- Notun month tab auto-create — header row "TEMPLATE" tab theke clone korbo, naki apni manually first time setup korben?
