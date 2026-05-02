## Diagnosis

USDT entry `c73224db…` (11,800 USDT @ 126.75, approved 2026-05-02 11:43:46 by superadmin Md Maksudur Rahaman):
- `status = approved`, `telegram_forwarded = false`, no `telegram_message_id`
- Edge function logs show **`forward-seller-proof` was never invoked** for this row (and also for the 23:16 approval yesterday — same pattern).
- The 11:13 USDT approval (msg_id 50) for the same seller/admin/bank worked fine.

So the call from `AdminSellers.tsx` `reviewTxnMutation` (line ~652 — `supabase.functions.invoke("forward-seller-proof", …)`) is silently failing on the client side (network blip / aborted request / browser tab closed / token issue) and the `try/catch` at line 667 swallows the error. There is **no server-side safety net** — once that one client-side `invoke` is missed, the row stays unforwarded forever.

Same risk exists for:
- `forward-proof` (top-up approvals) — only fired from a DB trigger HTTP post or client invoke.
- BDT payment / withdraw rows that fail the same way.

We also have a separate latent bug: `supabase.from('system_logs').insert({…}).catch(() => {})` on line 153 of `forward-seller-proof/index.ts`. PostgrestBuilder has no `.catch` method — this throws `TypeError: …catch is not a function`. It's currently caught by the outer try/catch so it doesn't break forwarding, but it pollutes logs and the same pattern caused the visible 500 in `sync-seller-to-sheet`.

## Fix Plan

### 1. Auto-forward backfill via DB trigger (server-side safety net)
Add a Postgres trigger on `seller_transactions` AFTER UPDATE/INSERT that fires when:
- `status = 'approved'` AND
- `telegram_forwarded = false` AND
- type IN ('usdt_received','bdt_payment','withdraw')

It calls `net.http_post → forward-seller-proof` with the same payload shape the client uses. This makes forwarding **independent of the browser** — even if the admin's tab crashes mid-approval, the trigger still fires.

Mirror trigger for `top_up_requests` already exists (`sync_seller_transaction_for_approved_topup`), so no change needed there.

### 2. Forward the orphaned txn (`c73224db…`) right now
After the trigger is in place, run a one-shot UPDATE that bumps `reviewed_at = now()` (or call the edge function directly with its id) so it forwards. We'll also forward the older 23:16 row (`64ddf11d…`).

### 3. Manual "Resend to Telegram" button per row (admin UI)
On every approved row in the admin seller ledger, show a small icon button when `telegram_forwarded = false` that re-invokes `forward-seller-proof`. So even if both auto-paths fail, the admin can recover with one click — no more guessing.

### 4. Fix the `.catch` bug
Replace `supabase.from('system_logs').insert({…}).catch(() => {})` with proper `try { await … } catch {}` blocks in:
- `supabase/functions/forward-seller-proof/index.ts` (line 150–153)
- `supabase/functions/forward-proof/index.ts` (line 130–134)
- `supabase/functions/sync-seller-to-sheet/index.ts` (the 500 we saw — same root cause around line 460)

### 5. Accuracy guard already in place
`forward-seller-proof` already pulls the dashboard balance live via `fetchAllSellerTxns + computeDueAdvance`. Combined with #1 (the trigger fires AFTER the row is in `seller_transactions`), the forwarded `Total:` line will always match the dashboard.

## Technical details (database migration)

```sql
create or replace function public.trigger_forward_seller_txn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proof text;
  v_kind text;
begin
  -- Only on approved + not yet forwarded + qualifying type
  if NEW.status <> 'approved' then return NEW; end if;
  if coalesce(NEW.telegram_forwarded, false) = true then return NEW; end if;
  if NEW.type not in ('usdt_received','bdt_payment','withdraw') then return NEW; end if;

  -- On UPDATE, only fire when transitioning into approved
  if TG_OP = 'UPDATE' and OLD.status = 'approved' then return NEW; end if;

  v_kind := NEW.type;
  v_proof := NEW.proof_url;

  begin
    perform net.http_post(
      url := 'https://dhswrfzdqcavgmymllat.supabase.co/functions/v1/forward-seller-proof',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer <anon-jwt>"}'::jsonb,
      body := jsonb_build_object(
        'seller_transaction_id', NEW.id,
        'payment_kind', v_kind,
        'proof_url', v_proof,
        'seller_id', NEW.seller_id,
        'usdt_amount', NEW.usdt_amount,
        'rate', NEW.rate,
        'bdt_amount', NEW.bdt_amount,
        'bank_account_id', NEW.bank_account_id
      )
    );
  exception when others then
    raise warning 'forward-seller-proof trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$$;

create trigger trg_forward_seller_txn
after insert or update on public.seller_transactions
for each row execute function public.trigger_forward_seller_txn();
```

The edge function itself already resolves `seller_name`, bank info, and `others_telegram_group_id` from DB lookups when missing, and `claim_forward_slot` already prevents duplicate sends if both client + trigger race.

## Outcome

After this:
- USDT / BDT / Withdraw approvals always reach Telegram, even on bad network.
- Total in the Telegram caption always equals the dashboard balance (already enforced).
- Admin has a manual resend button as a final fallback.
- Any future mismatch is logged to `system_logs` (now without crashing).
