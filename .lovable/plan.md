# Fix: Duplicate Telegram Forward + Tenant Limit Not Decreasing

## Problem 1: Same top-up proof Telegram e duibar forward hocche (random)

### Root cause
Currently 2 different paths invoke `forward-proof` for the same approved top-up:

1. **DB trigger** `sync_seller_transaction_for_approved_topup` → fires `net.http_post` to `forward-proof` whenever a top-up flips to `approved`.
2. **`auto-verify-pending` cron** (runs per minute) + **`verify-topup`** + **manual resend buttons** (AdminTopUp, SellerNotForwardedCard, ForwardAudit) — these also invoke `forward-proof` directly.

The `claim_forward_slot` atomic lock in `forward-proof` is the only dedupe gate. It works for *truly* concurrent calls (millisecond-overlap), but breaks in this scenario:

- Trigger fires forward-proof → succeeds → calls `complete_forward_slot` → but the row update to `top_up_requests.telegram_forwarded = true` happens AFTER `complete_forward_slot`.
- If a second invocation (cron / manual) arrives between `complete_forward_slot` and the flag update, `claim_forward_slot` returns FALSE (slot exists with `telegram_message_id`), and the function correctly self-heals via the `slot.telegram_message_id` branch and returns `skipped: already_forwarded`. ✅ This path is safe.

The actual duplicate happens when Telegram's `sendPhoto` call **succeeds on Telegram's side but the HTTP response fails/times out at our end** (network blip). The code path:
```
tgResp = fetch(...)  →  network error  →  caught by outer try/catch
                                            ↓
                              "forward-proof error" log
                              NO release_forward_slot
                              Slot stays orphan (no message_id)
```
But wait — there's a worse case: `tgResult.ok === false` (Telegram returns 4xx JSON) → code calls `release_forward_slot`. If Telegram actually DELIVERED the photo and returned a non-ok body (rare — e.g. flood-control retry-after with the message still queued), the slot is released → next invocation re-sends.

More importantly: I suspect the duplicates come from the trigger firing **twice** because `sync_seller_transaction_for_approved_topup` is attached to **both INSERT and UPDATE** of `top_up_requests` — and `verify-topup` flow does (approve update) then (`telegram_forwarded` init update). The second UPDATE re-fires the trigger before the first invocation completes its `complete_forward_slot` — so `claim_forward_slot` succeeds twice on a fresh slot.

### Fix
1. Make `claim_forward_slot` **strict-once**: tighten the trigger to fire ONLY on the status transition into `approved` (guard `OLD.status IS DISTINCT FROM 'approved' AND NEW.status = 'approved'`), and skip the trigger entirely when `telegram_forwarded` is already non-null.
2. In `forward-proof`, when Telegram returns a non-ok body, do NOT release the slot — instead mark it `failed` (add a column or use `telegram_message_id = -1`) so retries go through the manual resend path with explicit operator intent.
3. Add an outer-try `release_forward_slot` ONLY for true pre-Telegram errors (bot token missing, group ID missing) — never after the `fetch` call returns.

## Problem 2: Tenant limit Remaining komche na (usage report broken)

### Root cause
The flow is: **tenant app** (`spend-cap-update`) → POSTs `report-usage` to **master** (`tenant-webhook`) → master calls `apply_tenant_usage` RPC → bumps `tenants.total_used` → Remaining drops.

Two likely breakage points:
1. **Tenant-side**: `spend-cap-update` reads `master_url` + `tenant_api_key` from a `licenseMap`. If those keys are unset/stale on a remixed tenant instance, the report POST silently fails (warning only) and master never sees the usage. The screenshot is from master, so master never received the report.
2. **Master-side regression**: A recent edit may have stopped calling `apply_tenant_usage` from `tenant-webhook` case `report-usage`. Need to verify `tenant-webhook` line 622–664 still calls the RPC and that the RPC is unchanged (it currently looks correct — `total_used = GREATEST(0, total_used + delta)`).

### Fix
1. **Audit recent commits on `tenant-webhook` and `apply_tenant_usage`** — restore the prior `report-usage` branch behavior if regressed.
2. Surface tenant→master report failures: when `spend-cap-update` gets non-200 from master, write a `system_logs` row (currently only `console.warn` which is invisible to the admin) so the operator sees "usage report failed".
3. Add a one-time **backfill RPC** the admin can run from master that pulls each tenant's `daily_spend_stats` for the missing window and replays missed `apply_tenant_usage` calls (idempotent via `idempotency_key`), so the existing limit Remaining catches up to actual spend.

## Touched files
- `supabase/functions/forward-proof/index.ts` — don't release slot after Telegram fetch returns
- DB migration: tighten `sync_seller_transaction_for_approved_topup` trigger to fire only on `OLD.status != 'approved' AND NEW.status = 'approved'`
- `supabase/functions/spend-cap-update/index.ts` — log master report failures to `system_logs`
- `supabase/functions/tenant-webhook/index.ts` — verify `report-usage` branch (no behavior change unless regression confirmed)
- New DB migration: `replay_tenant_usage_from_daily_stats(p_tenant_id, p_from, p_to)` RPC for catch-up backfill

## Locked-flow notice
Top-up forward + tenant ledger duitai `CRITICAL_LOCKED_FUNCTIONS.md` e listed. Edit korar age confirm chacchi karon eta money/limit-impacting flow.

## Confirmations needed before build
1. **Problem 2 master-side**: Tumi ki recently `tenant-webhook` / `apply_tenant_usage` e kichu change koreche or remix korche? Ami bujhte chai whether eta tenant→master network issue, na master logic regression.
2. **Backfill scope**: Ki koto din er missing usage replay korte hobe? (e.g. last 7 days, last 30 days)
3. **Trigger tightening**: OK acche ki sudhu status transition e fire korbe — manual reopen / re-approve flow tomar nei to?
