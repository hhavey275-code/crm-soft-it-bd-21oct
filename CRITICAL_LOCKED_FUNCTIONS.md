# 🔒 CRITICAL LOCKED FUNCTIONS — DO NOT MODIFY WITHOUT EXPLICIT APPROVAL

This file lists the production-stable flows. When **remixing this project to a new
workspace** or doing unrelated UI changes, AI agents and developers MUST treat
these files as locked. Any change here can break payment approval, money flow,
or Telegram forwarding.

If you must change something here, do it in an isolated PR, manually test the
full flow, and update this file with the date + reason.

---

## 1. Top-Up Auto-Approval Pipeline (LOCKED)

These pieces work together. Changing one without the others WILL break auto-approval.

| File | Role | Lock Reason |
|------|------|-------------|
| `supabase/functions/ocr-seller-payment/index.ts` | OCR + strict account verify (first3+last4; mfs_to_bank fallback first3+last3) | Loosening re-opens wrong-screenshot approvals |
| `supabase/functions/verify-topup/index.ts` | Final verification (amount, ref, account, Telegram SMS, dup ref) | Money flow gate |
| `supabase/functions/auto-verify-pending/index.ts` | Per-minute cron — pulls Telegram, re-runs verify-topup for pending/hold | Cron-driven, must stay <50 rows scope |
| `supabase/functions/telegram-poll/index.ts` | Telegram bank-SMS ingestion | Source of truth for SMS matching |
| DB function `sync_seller_transaction_for_approved_topup` | Mirrors approved top-up into seller_transactions + triggers forward-proof | Bookkeeping + Telegram forward |
| DB function `prevent_duplicate_topup_credit` | Blocks double-credit | Money safety |
| DB function `prevent_duplicate_topup_invoice` | Blocks duplicate invoice | Billing safety |

**Account-match rules (LOCKED):**
- `bank_transfer` (online_transfer), `npsb`, `atm_deposit`, `cash_deposit`: full match OR `first3+last4` only.
- `mfs_to_bank`: above + narrow fallback `first3+last3` when OCR account is masked/partial. Admin log tags `[mfs_to_bank first3+last3 fallback]`.
- `MFS` (bKash/Nagad merchant): MFS flow, ref+amount+Telegram SMS.

---

## 2. Payment Proof Forwarding (LOCKED)

| File | Role |
|------|------|
| `supabase/functions/forward-proof/index.ts` | Forwards client top-up proof to seller's Telegram group |
| `supabase/functions/forward-seller-proof/index.ts` | Forwards seller usdt/bdt/withdraw proof |
| DB functions `claim_forward_slot` / `complete_forward_slot` / `release_forward_slot` | Idempotency lock — prevents double-forwarding |
| DB trigger `trigger_forward_seller_txn` | Auto-forwards on approved seller_transaction |

Never call forward-* without going through `claim_forward_slot` first.

---

## 3. Auth & Role System (LOCKED)

| File | Role |
|------|------|
| `src/contexts/AuthContext.tsx` | Session restore, role fetch, hard signOut (clears `sb-*` + `cached_role`, redirects to `/auth`) |
| DB table `user_roles` + function `has_role` | Server-side role check (NEVER store role on profiles) |
| `src/components/ProtectedGuard.tsx` | Route gate |

**Rules:**
- Roles ONLY live in `user_roles`. Never on `profiles`/`users`.
- `has_role` is `SECURITY DEFINER` — used in RLS to avoid recursion. Don't rewrite RLS to query `user_roles` directly.
- `signOut()` must reset state immediately, clear all `sb-*` localStorage keys, then redirect.

---

## 4. Tenant Usage / Limit Ledger (LOCKED)

| File | Role |
|------|------|
| DB function `apply_tenant_usage` | Idempotent usage report/refund |
| DB function `approve_tenant_limit_payment` | Limit purchase approval |
| DB function `adjust_tenant_system_limit` | Manual admin adjust |
| DB function `recalculate_tenant_ledger` | Replays full ledger — only for repair |
| DB function `_tll_insert` | Internal ledger writer |
| `supabase/functions/tenant-webhook/index.ts` | Master ↔ tenant API |
| `src/lib/tenantForward.ts` | Tenant → master forwarder |

Never write directly to `tenants.system_limit` or `tenants.total_used`. Always
go through the RPCs above so the ledger stays consistent.

---

## 5. Stripe (LOCKED)

| File | Role |
|------|------|
| `supabase/functions/stripe-webhook/index.ts` | Signature verify + idempotent payment handling |
| `supabase/functions/create-stripe-checkout/index.ts` | Session creation |

Webhook signature verification must never be removed or relaxed.

---

## 6. Sheet Sync (LOCKED)

| File | Role |
|------|------|
| `supabase/functions/sync-seller-to-sheet/index.ts` | Pushes approved seller txns to Google Sheets |
| DB trigger `trigger_sheet_sync_on_seller_txn` | Auto-fires only on transition INTO `approved` |

Trigger guard `IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN RETURN`
prevents duplicate sheet rows. Don't remove.

---

## 7. Required Secrets (must be re-added on remix)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`,
`USER_GEMINI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `LOVABLE_API_KEY`,
`META_PROXY_URL`, `META_PROXY_SECRET`, `SCHEDULED_SYNC_SECRET`,
`SB_MGMT_PAT`, `SB_MGMT_TOKEN`, `GOOGLE_SHEETS_API_KEY`.

Telegram bot token + group IDs live in `site_settings` / `bank_accounts` rows.

---

## 8. When Remixing to a New Workspace

1. Re-add ALL secrets above.
2. Re-create pg_cron jobs that call `auto-verify-pending`, `telegram-poll`, `scheduled-sync`.
3. Re-add the Telegram bot to bank groups; refresh `telegram_group_id` in `bank_accounts`.
4. Re-set `site_settings.master_url` + `tenant_api_key` if tenant mode.
5. Run a real end-to-end top-up before opening to clients.

---

**Last reviewed:** 2026-05-08. Bump this date when you re-verify the flow.
