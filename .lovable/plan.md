## Goal

Tenant Usage Log (`TenantUsageLog.tsx`) ke admin side er Limit Log er moto consistent banano — jate `usage_topup` (consumption) clearly **negative / "Consumed"** hisebe dekhay, ar prottek row e **System Limit + Remaining** dekha jay (2nd screenshot er moto).

## Current problem

Ekhon row dekhay:
- `usage_topup` badge + **+$20** (orange) → mone hocche limit barche, asole used barche
- "Local Before → After" shows used jumping up — semantics correct kintu sign confusing
- Limit / Remaining per row dekhano nai

User-er expectation (limit 100, top-up 10):
- Limit 100, Used 10, **Remaining 90 (−10 from full)**
- Pore: Limit 100, Used 25, **Remaining 75 (−15 step)**

## Changes (UI only — `src/components/tenant/TenantUsageLog.tsx`)

### 1. Row presentation rework (mobile card + desktop table)

Per row map `action` → display:

| action | Badge | Amount color | Sign |
|---|---|---|---|
| `report-usage` / `usage_topup` | **Consumed** (red/destructive soft) | destructive | **−$X** |
| `refund-usage` / `usage_refund` | **Refunded** (green soft) | green-500 | **+$X** |
| `limit_purchase` | **Limit Purchase** (green) | green-500 | **+$X** |
| `limit_manual_increase` / `limit_set` (delta>0) | **Limit ↑** | green | **+$X** |
| `limit_manual_decrease` (or delta<0) | **Limit ↓** | destructive | **−$X** |
| anything else (master_sync / reconcile) | source label fallback | muted | signed delta |

Use `movement_type` if present, else fall back to `action`.

### 2. Per-row "System Limit / Remaining" line (like 2nd SS)

Each row shows below the amount:

```
System Limit       $X,XXX.XX
Remaining          $YYY.YY     ← red if negative or low
```

Source of truth per row:
- `system_limit_after` (from `tenant_limit_ledger`) if available
- Remaining = `system_limit_after − total_used_after`

Currently the query pulls from `tenant_usage_audit` which only has `local_total_used_*` and `master_total_used_after`. Need to also surface limit. Two options:

**Option A (preferred, no schema change):** Switch the audit query to read from `tenant_limit_ledger` (already populated by `_tll_insert` with `system_limit_before/after`, `total_used_before/after`, `remaining_before/after`, `movement_type`). This table has everything needed.

**Option B:** Keep `tenant_usage_audit` and join current `system_limit` from tenants (less accurate historically).

Plan picks **Option A**. `tenant_usage_audit` view stays for backward compat but the Usage Log UI reads `tenant_limit_ledger` ordered by `created_at DESC LIMIT 200`.

### 3. Drop the misleading "+/−" prefix on raw amount

Compute sign from movement direction, not from string match on `"refund-usage"`.

### 4. Keep top summary cards as-is

Local Used / Master Used / Drift cards stay — they're correct.

### 5. Keep idempotency key + status badges

DUP / ERR / HTTP status badges stay (smaller, secondary placement).

## Out of scope

- No DB schema change.
- No backend / edge function change.
- Admin-side Limit Log component already matches 2nd screenshot — not touched.
- Master sync / reconcile logic unchanged (separate question still pending from previous turn).

## Acceptance

- A `usage_topup +$20` row now renders: **Consumed  −$20.00**, with "System Limit $8,008.12 · Remaining $-475.61" line.
- A `limit_purchase` row renders: **Limit Purchase  +$1,000.00**, remaining jumps up.
- Refund renders green **Refunded +$X**.
- Mobile + desktop both updated.
