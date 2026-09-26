# Client spend cap withdraw: maximum = remaining minus $10

## What changes
- When a client opens Withdraw on an ad account, the app reads the live spending limit and spend from Meta and shows:
  - Live Spend Cap, Live Spent, Remaining
  - **Max you can withdraw = Remaining − $10** (never below $0)
- The amount box won't accept more than that maximum. Submit stays off, with a red note, when the amount is too high.
- This applies both to clients allowed to withdraw directly and to clients who send a request for admin approval. Both see the live maximum first.
- If Meta can't be read, the client sees "Couldn't read the live limit, try again" and can't submit.
- The server enforces the same rule too, so the $10 buffer can't be bypassed.
- Admin withdrawals stay the same (no $10 buffer).

## Technical details
- `supabase/functions/spend-cap-withdraw`: for non-admins, `maxWithdrawable = max(0, liveCap − liveSpent − 10)`. Return it from `dry_run` along with the raw remaining. Reject larger amounts. Also reject when `dry_run` is used by a non-admin without an assignment, as it does now.
- The dry run currently requires `spend_cap_withdraw_enabled`. Allow `dry_run` for assigned clients even without permission, so request-mode clients can see live data. The actual withdraw still requires permission.
- `ClientAdAccounts.tsx`: `openWithdraw` always runs the dry run, shows the live breakdown, and caps input and submit at `withdrawMax`, in both direct and request branches.
- Admin approval (`AdminWithdrawRequests`) runs through the edge function as admin, so the live cap check still happens at approval.
- The edge function must be redeployed.
