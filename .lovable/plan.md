# Top-Up Approval → WhatsApp Auto-Message

Client-er top-up approve howar songe songe client-er WhatsApp-e ekta message chole jabe: "Top-up approved" + amount + notun wallet balance. WhatsApp Business via **Sinch** connector use korbo.

## Kaj korar step

### 1. Sinch connector connect
- `standard_connectors--connect` diye WhatsApp Business (Sinch) connect korano hobe.
- Verified WABA number + approved template lagbe (Sinch dashboard theke).
- Ekta approved template banate hobe, e.g. name `topup_approved`, body:
  `Assalamu Alaikum {{1}}, apnar $ {{2}} top-up approve hoyeche. Current wallet balance: $ {{3}}. Dhonnobad.`

### 2. Notun server function — `notify-topup-whatsapp`
File: `src/lib/notifyTopupWhatsapp.functions.ts` (server fn, `createServerFn`).

Input: `{ topUpRequestId: string }`. Kaj:
- `supabaseAdmin` diye `top_up_requests` theke user_id, amount, status niye.
- `profiles` theke `phone` + `full_name` niye. Phone ke E.164 normalize (default `+880` prefix jodi na thake).
- `wallets` theke current `balance` niye.
- Sinch gateway call: `POST https://connector-gateway.lovable.dev/sinch/...` (exact path connect korar por `get_connection_secrets` + docs theke confirm hobe — template send endpoint).
- Failure hole shudhu warning log — top-up flow break korbe na.

### 3. Trigger points (LOCKED files-e minimal add)
Existing 3 approval path-e ekta fire-and-forget call add hobe (await na kore, catch chup):

| File | Line context |
|------|--------------|
| `supabase/functions/verify-topup/index.ts` | approve success block-er por (auto approval) |
| `src/components/admin/AdminTopUp.tsx` | manual approve success-er por |
| `src/components/agency/AgencyTopUp.tsx` | agency approve success-er por |

Server-side (`verify-topup`) theke direct fetch call korbe internal server route/function URL-e. Client-side gulate `notifyTopupWhatsapp({ data: { topUpRequestId } })` server fn call. Kono existing logic touch hobe na — shudhu ek line add.

### 4. Opt-out / safety
- Jodi `profiles.phone` khali ba invalid hoy → skip, kono error na.
- Duplicate protection: `top_up_requests`-e ekta boolean column `whatsapp_notified` add kore migration diye. Server fn shudhu `false` hole pathabe, tarpor `true` kore rakhbe. Ei ta thakle same request-er notification duicharbar jabe na (retry/cron chalale).

## Client-facing behavior
Approval-er ~2-3 sec vitor client-er WhatsApp-e message chole ashbe. Wallet balance real-time value (approve howar por-er). Cost: Sinch-er per-message WhatsApp rate.

## Requirements user theke
- Sinch WhatsApp Business account + verified sender number.
- Template `topup_approved` (3 variable: name, amount, balance) Meta-te approved.
- Connect flow chalu korle Sinch WABA ID / sender number ready rakhte hobe.

## Files touched
- **NEW:** `src/lib/notifyTopupWhatsapp.functions.ts`
- **NEW:** ekta migration — `top_up_requests.whatsapp_notified boolean default false`
- **EDIT (1 line each):** `verify-topup/index.ts`, `AdminTopUp.tsx`, `AgencyTopUp.tsx`

Locked flows-er core logic-e kono poriborton nai — shudhu approval success-er por ekta side-effect call.
