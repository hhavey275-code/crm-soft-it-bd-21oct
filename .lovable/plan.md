# Tenant ↔ Master Sync: Chat, BM Share & Withdraw Requests

Goal: tenant instances (separate Lovable projects with their own DB) need to forward 3 things to the **master** project so superadmin/admin can see + reply: (a) client chat messages from the tenant's ChatWidget, (b) BM share requests (existing "Request BM Access" flow), (c) Spend-cap withdraw requests (new button next to ad accounts).

Currently `useTenantLicense` POSTs heartbeat to `${master_url}/functions/v1/tenant-webhook` — but **that function does not exist** on the master. So nothing from the tenant ever reaches the master. We will create it and wire all four message types (`heartbeat`, `chat_message`, `bm_share_request`, `spend_cap_withdraw_request`) through it.

---

## 1. Master side — `tenant-webhook` Edge Function (NEW)

Create `supabase/functions/tenant-webhook/index.ts` on the master project. Single entrypoint, switches on `body.action`:

- **Auth**: validates `X-Tenant-Key` header against `tenants.api_key`. If missing/invalid → 401. Resolves `tenant_id` from the matched row.
- **Actions**:
  - `heartbeat` — same response shape `useTenantLicense` already expects (status, system_limit, total_used, subscription_*, usd_rate). No write needed beyond bumping `tenants.last_heartbeat_at`.
  - `chat_message` — payload `{ tenant_user_id, tenant_user_name, tenant_user_email, message, conversation_key }`. Upsert into `tenant_chat_conversations` (one per `tenant_id + conversation_key`), insert row in `tenant_chat_messages` with `direction='inbound'`. Master admin reply is handled separately (see §3).
  - `bm_share_request` — payload `{ tenant_user_id, tenant_user_name, ad_account_external_id, ad_account_name, bm_id, bm_name, note }`. Insert into `tenant_bm_share_requests` (status='pending').
  - `spend_cap_withdraw_request` — payload `{ tenant_user_id, tenant_user_name, ad_account_external_id, ad_account_name, amount_usd, note }`. Insert into `tenant_withdraw_requests` (status='pending').
- Returns `{ ok: true, id?: <newRow.id> }` so the tenant can show a toast.
- All inserts also write a `system_logs` row (action: `Tenant: <type>`, details include tenant name + user name + IP).

## 2. Master side — DB tables (NEW migration)

Add migration creating:

- `tenant_chat_conversations` — `id`, `tenant_id` (fk → tenants), `tenant_user_id` (text, the user id inside the tenant project), `tenant_user_name`, `tenant_user_email`, `last_message_at`, `is_resolved`, `created_at`. Unique on `(tenant_id, tenant_user_id)`.
- `tenant_chat_messages` — `id`, `conversation_id` (fk), `direction` ('inbound' tenant→master, 'outbound' master→tenant), `sender_label` (e.g. tenant user name or admin full_name), `message`, `is_read`, `created_at`.
- `tenant_bm_share_requests` — `id`, `tenant_id`, `tenant_user_id`, `tenant_user_name`, `ad_account_external_id`, `ad_account_name`, `bm_id`, `bm_name`, `note`, `status` (pending/approved/rejected), `admin_notes`, `created_at`, `resolved_at`, `resolved_by`.
- `tenant_withdraw_requests` — `id`, `tenant_id`, `tenant_user_id`, `tenant_user_name`, `ad_account_external_id`, `ad_account_name`, `amount_usd` (numeric), `note`, `status`, `admin_notes`, `created_at`, `resolved_at`, `resolved_by`.

RLS: enable on all 4. Policies — `superadmin OR admin` (using existing `has_role`) gets full SELECT/UPDATE; INSERT only via service role (the edge function). No client/seller/agency can read.

## 3. Master side — UI surfaces

### 3a. AdminChat — tenant chat shows in same inbox with badge
(`src/components/admin/AdminChat.tsx`)

- Extend `loadConversations()` to also fetch `tenant_chat_conversations` + their last message + unread count, and merge into the same list (sorted by `last_message_at`).
- Each conversation gets a `source` field: `"client"` (existing) or `"tenant"`. Tenant rows render with a small purple `<Badge>Tenant: {tenants.name}</Badge>` next to the name (this is the "super-admin badge" the user asked for).
- When a tenant conversation is selected:
  - Messages load from `tenant_chat_messages` (not `chat_messages`).
  - Replies insert into `tenant_chat_messages` with `direction='outbound'`. Then call a new `notify-tenant` edge function (or reuse `tenant-webhook`'s reverse path) — see §3b.
- Realtime: subscribe to inserts on `tenant_chat_messages` and `tenant_chat_conversations` in addition to existing channels.

### 3b. Master → Tenant reply delivery

Tenant has no inbound webhook for now; instead, the tenant's ChatWidget will **poll** for new outbound messages whenever the user opens it / on a 15s interval while open. So no extra master function is needed — the tenant pulls via the same `tenant-webhook` action `pull_chat` (returns messages where `direction='outbound' AND created_at > since`). This keeps master->tenant one-way through the same single function and avoids exposing the tenant's DB.

### 3c. AdminBusinessManagers — Tenant Requests panel
(`src/components/admin/AdminBusinessManagers.tsx`)

Add a new collapsible section at the top of the page: **"Tenant Requests"** with two sub-tabs:

- **BM Share Requests** — table over `tenant_bm_share_requests` where `status='pending'`. Columns: Tenant, User, Ad Account, BM (name + id), Note, Created. Actions: `Approve` / `Reject` (writes status + admin_notes + resolved_by/at, also pushes a `chat_message` outbound to that tenant user so they see the decision).
- **Withdraw Requests** — table over `tenant_withdraw_requests` where `status='pending'`. Columns: Tenant, User, Ad Account, Amount (USD), Note, Created. Actions: `Approve` / `Reject` (same flow).

Pending count badges shown next to each tab title. Resolved items hidden by default with a "Show resolved" toggle.

Visibility: render the section only if `isAdmin || isSuperAdmin` (per user's answer).

## 4. Tenant side — wire the existing UI to push to master

These edits live in the **tenant** Lovable project (same codebase template, just deployed as a tenant instance with `is_tenant=true`). All three changes go through one new helper:

`src/lib/tenantForward.ts` (NEW) — single helper that reads `master_url + tenant_api_key` from `site_settings`, POSTs to `${master_url}/functions/v1/tenant-webhook` with `X-Tenant-Key`, and returns `{ ok, id?, error? }`. All three flows below call this.

### 4a. ChatWidget (`src/components/ChatWidget.tsx`)

- After local `chat_messages` insert succeeds, if `useTenantLicense().isTenant` → also call `tenantForward({ action: 'chat_message', payload: { conversation_key: user.id, tenant_user_id: user.id, tenant_user_name, tenant_user_email, message } })`. Local insert remains so the tenant's own admin can also see the chat in their own AdminChat.
- Add a 15s `setInterval` while the widget is **open** that calls `tenantForward({ action: 'pull_chat', payload: { conversation_key: user.id, since: <last seen timestamp> } })` and inserts any returned outbound messages into the local `chat_messages` table (sender_id set to a special UUID `00000000-0000-0000-0000-000000000000` representing "Master Support") so they appear inside the tenant user's existing chat UI.

### 4b. BM share request (`src/components/client/ClientAdAccounts.tsx` → `handleBmReqSubmit`)

- After the existing local `bm_access_requests` insert succeeds, if `isTenant` → also `tenantForward({ action: 'bm_share_request', payload: { tenant_user_id, tenant_user_name, ad_account_external_id: bmReqAccount.account_id, ad_account_name, bm_id, bm_name, note } })`. Failure of the forward shows a non-blocking warning toast — local request still recorded.

### 4c. Withdraw request (NEW button in `ClientAdAccounts.tsx`)

- Add a new dropdown menu item next to "Request BM Access": **"Request Spend Cap Withdraw"**. Opens a small dialog asking for **Amount (USD)** and optional **Note**.
- On submit:
  - Insert a row into a new local table `spend_cap_withdraw_requests` (id, user_id, ad_account_id, amount_usd, note, status='pending', created_at) — created in the same migration as §2.
  - If `isTenant` → also `tenantForward({ action: 'spend_cap_withdraw_request', payload: { ... } })`.
  - Toast confirmation, no actual spend cap change here — the actual cap reduction happens later when a master admin approves; that approval flow is **out of scope** for this iteration (master just records + shows the request).

## 5. Things explicitly NOT in this iteration

- Auto-executing the spend cap reduction when a withdraw request is approved (admin will do it manually in their existing flow for now).
- Tenant-side admin UI for these requests (they only flow tenant-user → master-admin).
- File/image attachments in tenant chat.
- Two-way realtime for tenant chat (we use 15s poll while widget is open; good enough for support chat; can upgrade to webhooks later).

## 6. Files touched

- NEW `supabase/functions/tenant-webhook/index.ts` (master)
- NEW migration: 4 tables + RLS + 1 local table `spend_cap_withdraw_requests`
- NEW `src/lib/tenantForward.ts`
- EDIT `src/components/admin/AdminChat.tsx` — merge tenant conversations + replies route through `notify-tenant` outbound row
- EDIT `src/components/admin/AdminBusinessManagers.tsx` — Tenant Requests section (BM share + Withdraw tabs)
- EDIT `src/components/ChatWidget.tsx` — forward + 15s poll while open
- EDIT `src/components/client/ClientAdAccounts.tsx` — forward BM req + new Withdraw req button/dialog

No changes to `useTenantLicense` itself — once the master's `tenant-webhook` exists, the existing heartbeat call will start succeeding automatically.