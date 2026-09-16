# Auto-pilot: external top-up requests approved and topped up without a click

## The one hard limit

Admiki (and the other CRMs) have no API. The top-up only works inside a browser
that is already logged in to that CRM. So the top-up can never run on our
server — it always needs one logged-in Chrome window somewhere.

What we can remove is the human click. Plan: turn the helper into an
**auto-pilot** that watches for new requests by itself and runs the whole
"Approve & Top-Up" flow automatically, as long as one Chrome window with the
helper is open and logged in to the CRM. Best used on one PC that stays on
(office desktop or a cheap always-on machine). If no such window is open,
requests simply wait, exactly like today, and any admin can still press
Approve & Top-Up manually.

## What the admin sees

- A new **Auto-pilot** card on the External Top-Up page with an on/off switch,
  the CRM it is watching, and a live status line ("watching — last checked 12s
  ago" / "topping up $50 for AU784…" / "off").
- Turning it on once on that PC is enough; it keeps running after page close
  and after Chrome restarts (until switched off).
- Every automatic top-up is written to the request history and the system log
  with "auto-pilot" as the actor, so it is auditable.
- If a CRM top-up fails, auto-pilot stops touching that request, marks it for
  manual handling and shows a Chrome notification, so nothing silently hangs.

## How it works

1. **Enable once:** dashboard mints a long-lived (30 day) auto-pilot token for
   the chosen CRM host and hands it plus the CRM URL to the extension, which
   stores it in `chrome.storage.local`.
2. **Watch:** the extension service worker polls our endpoint every ~20 seconds
   (`chrome.alarms`). One job at a time, never in parallel.
3. **Claim:** the endpoint picks the oldest pending request for that CRM host,
   marks it approved/completed with `complete_external_topup` (same as the
   manual button does now), stamps `automation_started_at`, and returns a
   short-lived top-up token — so the same request can never be claimed twice.
4. **Run:** the worker opens the CRM in a background tab with
   `#crmtopup=<token>`; the existing `content.js` automation does search →
   "+" → amount → Increase Spend Cap → Yes, increase it!, then the tab closes.
5. **Repeat** with the next pending request.

## Technical changes

- `src/routes/api/public/crm-topup.ts`
  - `create_autopilot`: admin-authenticated, verifies admin/superadmin, returns
    a signed token with `scope: "autopilot"`, `host`, `actorId`, 30-day expiry.
  - `poll`: accepts an autopilot token, selects the oldest `pending`
    `external_topup_requests` row whose resolved external CRM URL matches the
    token host, resolves the ad account ID, calls `complete_external_topup`,
    then mints and returns a `scope: "topup"` token + accountId + amount +
    the CRM URL to open. Returns `{ ok: true, job: null }` when nothing pending.
    Claim guarded by the existing status check so double-claim is impossible.
- `src/lib/crmToken.server.ts` — allow the `autopilot` scope in the payload type.
- `crm-topup-extension/manifest.json` — add `alarms` + `tabs` permissions,
  version bump to **v1.2.0**.
- `crm-topup-extension/background.js` — real service worker: alarm-driven poll
  loop, single-flight lock, tab open/close per job, failure notification, plus
  message handlers for enable/disable/status.
- `crm-topup-extension/content.js` — accept `#crmauto=<token>&api=<base>&crm=<url>`
  to hand the auto-pilot token to the worker; after a job finishes in an
  auto-pilot tab, tell the worker so it can close the tab and continue.
- `crm-topup-extension/popup.html` / `popup.js` — show auto-pilot status and a
  stop switch.
- `src/components/admin/AdminExternalTopUpRequests.tsx` — Auto-pilot card
  (enable/disable, CRM selector defaulting to the taught host, status text),
  download button label updated to **v1.2.0**.
- Repackage `public/crm-topup-extension.zip`.

Manual Approve & Top-Up, Teach, Mark completed and reject/refund all stay
exactly as they are.
