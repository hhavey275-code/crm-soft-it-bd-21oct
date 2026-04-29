## Goal
"Update All from Meta" druto korbo + je accounts fail hobe automatic retry hobe + button er pase choto status text e success/fail count dekhabo. **System log e kichu likhbo na.**

## Changes

### 1. `src/lib/chunkedMetaSync.ts` — parallel + auto-retry
- Chunk size: 50 → **30** (timeout buffer barbe)
- Sequential loop er bodole **parallel pool concurrency=3** (Promise.all + simple limiter)
- All chunks done howar por jodi `failedAccountIds.length > 0` hoy → automatic ekbar **smaller batch (size 10) e retry** korbe oi failed ids gulo. Retry successful gulo `allInsights` e merge hobe ar `failedAccountIds` theke remove hobe.
- Return shape e notun field jog: `attempted`, `succeeded`, `failed` (number) — UI te dekhanor jonno.
- `onProgress(synced, total)` parallel pool e o thik kaj korbe (jokhonji ekta chunk shesh hobe synced += chunk.length)

### 2. `supabase/functions/get-account-insights/index.ts` — internal speedup
- `META_BATCH_SIZE`: 20 → **30**
- `META_BATCH_DELAY_MS`: 300 → **150**
(Edge function call backe data tara tara return korbe → client side timeout risk komabe)

### 3. UI — button er pase choto status text (3 jaygaya)
Files: `src/components/admin/AdminAdAccounts.tsx` (refreshAllMutation, refreshInventoryMutation, refreshSelectedMutation) + `src/components/admin/AdminDashboard.tsx` (2 ta refresh mutation)

- Mutation e notun state: `lastSyncStatus: { total, success, failed } | null`
- `onSuccess` e set korbo
- Header e existing "Synced X ago" / "Last sync used N calls" line er pasei choto text:
  - All success: `364/364 updated · 7 calls` (green text)
  - Partial: `350/364 updated · 14 failed (auto-retried)` (amber text)
- Toast o existing 1 ta thakbe — but jodi auto-retry ke success kore tahole green toast: `364 updated (14 auto-retried successfully)`. Jodi tao failed hoy: `350 updated, 14 failed — click Update again to retry`.

### 4. **NO system_logs entry** for Update All Meta
Per user request — kono extra log entry hobe na. `logSystemAction` call add korbo na update all flow e.

## Files touched
1. `src/lib/chunkedMetaSync.ts` — parallel pool + auto-retry layer + extended return
2. `supabase/functions/get-account-insights/index.ts` — META_BATCH_SIZE 30, delay 150ms
3. `src/components/admin/AdminAdAccounts.tsx` — status text near Update button (3 mutations)
4. `src/components/admin/AdminDashboard.tsx` — status text near Update button (2 mutations)

## Expected result
- 364 acc update: ~8 min → **~2-3 min** (parallel × 3)
- "2-3 hours ago" stale account drastically kombe (auto-retry layer)
- Tumi button er pasei dekhte parba: kotogula update holo, kotogula fail holo
- System logs tab e kono notun entry add hobe na

## Out of scope
- Full background job (BullMQ/queue) — lagbe na ei muhurte
- System log entries — user explicitly skip korte bolechen

Approve hole implement kore di.
