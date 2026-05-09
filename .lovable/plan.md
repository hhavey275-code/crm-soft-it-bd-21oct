## Real diagnosis (apnar point e ami bhul chilam — sorry)

Apni thik bolechen — bot je groups e ache shob group thekei poll kore, per-account `telegram_group_id` ingestion er jonne lage na. Same group `-1003763493818` thekei agei ৳1503***1001 er onek SMS thik ingest hoyeche (May 8 e 15+ row).

## Asol problem (DB evidence)

`telegram_messages` table query korlam:

| chat_id | last message ingested | count today |
|---|---|---|
| -1003763493818 (City Bank group) | **2026-05-09 08:22:34 UTC** | 4 |
| -1003580640919 (EBL) | 2026-05-09 07:07 | 2 |
| -1003856921490 | 2026-05-09 05:22 | 1 |

`telegram_bot_state`:
- `update_offset = 254446811`
- `updated_at = 2026-05-09 10:12:01 UTC` (cron heartbeat fresh)

Mane **08:22 UTC er por theke shob group e bot 0 ta message ingest korche**, kintu cron prottek minute e telegram-poll ke ping kore jacche (heartbeat update hocche). Apnar ৳2540 request 10:04 UTC e create — taar somoy theke polling effectively dead chilo, that's why SMS DB te ashe nai → verify-topup matched 0 → no auto-approve.

## Likely root causes (priority order)

1. **Webhook accidentally set on bot** — Telegram er rule: jodi `setWebhook` register thake, `getUpdates` 409 Conflict dey aar empty result return kore. Apnar codebase e telegram knowledge prompt e `setWebhook` exemple ache, possible kau accidentally call kore felechilo, or remix er somoy register hoye geche.
2. **Bot rate-limited / token issue** — 429 silently swallowed by poll fn
3. **Poll fn er try/catch silent failure** — Telegram API throws but exception swallow kore "ok" return kore (cron still updates `updated_at`)

`#1` shobcheye likely, karon shob 3 ta group e EXACT same time (08:22 UTC) theke ingestion stop hoyeche — group-specific issue na, bot-level issue.

## Fix plan

### Step 1 — Diagnose (1 min, read-only)
Ami `telegram-poll` edge function ke direct call kore actual response dekhbo (`curl_edge_functions`). Tarpor Telegram `getWebhookInfo` call kore confirm korbo webhook set ache kina.

### Step 2 — If webhook is set (most likely)
Telegram API e `deleteWebhook` call kore polling reset kore dewa. Ekta one-shot script / admin button. Tar por automatic e shob queued updates back-fill hobe (Telegram 24hr update buffer rakhe), aar ৳2540 er SMS shoho purano shob SMS ingest hoye jabe → `auto-verify-pending` cron amni amni request approve kore dibe.

### Step 3 — If webhook not set
`telegram-poll` edge function logs check korbo (08:22 UTC er por kotokkhon dhore error throw korche kina). Source code locally nei (CRITICAL_LOCKED_FUNCTIONS.md e mention ache, but file repo te nei) — Supabase dashboard theke fetch korte hobe.

### Step 4 — Ei specific ৳2540 request handle
Webhook delete kore purano updates flush korle ei SMS auto e ashbe → next cron run (1 min) e auto-approve hobe. Otherwise admin manually approve korbe.

### Step 5 — Permanent safeguard (optional, recommended)
Apnar **TelegramPollStatus** indicator je add korechilam, oitar logic ektu strict kora: `updated_at` fresh thakleo jodi `telegram_messages` table e shes 5 min e kichu insert na hoy AND pending top-up ache, then "🔴 Polling alive but ingesting 0 messages — webhook conflict?" warning dekhao. Tahole future e same silent failure 2 hour dhore na chole — sathe sathe dhora porbe.

## Questions before implementing

1. Step 1 (diagnose call) chalabo ekhoni? Read-only, kichu break hobe na.
2. Webhook delete er option chao automated korte (admin button dewa), naki ami one-time fix kore dilei cholbe?
3. Step 5 er smart polling indicator ("alive but stuck") add korte chao?