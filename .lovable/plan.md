## Goal
Pending top-up section er nichey ekta choto Telegram polling status indicator dekhabo, jate bujha jay polling kokhon cholche / next kotokkhon por hobe.

## Data source
- `telegram_bot_state.updated_at` — telegram-poll cron (`* * * * *`, every 1 min) ei row ta proti run e update kore. So eta = "last poll time".
- Cron schedule fixed: every 60s.

## UI behavior
Choto ekta line/badge (muted, text-xs), pending top-ups card er nichey:

- Jodi `now - updated_at < 5s` → 🟢 **"Polling now…"** (pulse animation)
- Else → 🔵 **"Last poll: {Xs} ago · Next in {Ys}"**
  - Ys = max(0, 60 - Xs)
  - Jokhon Ys = 0 hoye jabe → "Polling now…" e flip korbe (auto, refetch holey)
- Jodi `updated_at > 3 min purono` → 🔴 **"Polling stalled ({Xm} ago)"** (warning color)

Tick: client side `setInterval` 1s (just for countdown display).
Refetch `updated_at`: realtime subscription on `telegram_bot_state` (postgres_changes) + fallback poll every 15s.

## Files

1. **New**: `src/components/TelegramPollStatus.tsx`
   - useQuery → `supabase.from('telegram_bot_state').select('updated_at').eq('id',1).single()`
   - Realtime channel on `telegram_bot_state`
   - 1s tick via `useEffect` + `useState` for `now`
   - Compute label + color, render small inline status (icon + text, text-xs text-muted-foreground)

2. **Edit**: `src/components/FailedTopUps.tsx`
   - Existing component already shows pending failed top-ups. Mount `<TelegramPollStatus />` at the top or bottom of the card content (also when list is empty).

3. **Edit**: `src/components/admin/AdminTopUp.tsx` and `src/components/client/ClientTopUp.tsx`
   - Mount `<TelegramPollStatus />` near the pending-requests list header so user dekhte pay polling chalche kina.

## Out of scope
- Polling schedule change. Cron already 1 min — touch korchi na.
- Backend logic / verify flow — locked, untouched.

## Visual sketch
```
Pending Top-Ups (3)
... rows ...
─────────────────────
🟢 Polling now…
   or
🔵 Last poll 12s ago · Next in 48s
```
