// Persist Meta rate-limit headers + per-call log captured by meta-fetch.
// Called by edge functions after each Meta batch call.
import { getLastRateLimitHeaders, getMetaCallLog, clearMetaCallLog } from "./meta-fetch.ts";

interface PersistOptions {
  ad_account_db_ids?: string[]; // ad_accounts.id (uuid) — applies same account snapshot to all
  business_manager_db_id?: string | null;
  // Optional mapping: act_xxx -> ad_accounts.id (uuid) for call log resolution.
  account_id_map?: Record<string, string>;
}

// Estimate hourly call limit per ad account based on Meta's documented rules.
// Standard tier: 9000 + 100 * active_ads, Dev tier: 60 + 300 * active_ads (cap ~9000).
function estimateCallLimit(tier: string | null | undefined, activeAds: number): number {
  const ads = Math.max(0, activeAds || 0);
  const t = (tier ?? "").toLowerCase();
  if (t.includes("standard")) return 9000 + 100 * ads;
  if (t.includes("dev") || t.includes("development")) return Math.min(9000, 60 + 300 * ads);
  // Tier unknown — default to a generous Standard-tier baseline so the UI
  // shows a meaningful "X / 9000" rather than "X / 60".
  return 9000 + 100 * ads;
}

export async function persistMetaRateLimits(supabase: any, opts: PersistOptions) {
  const snap = getLastRateLimitHeaders();
  const log = getMetaCallLog();
  const now = new Date().toISOString();

  // Flush call log
  if (log.length > 0) {
    try {
      const map = opts.account_id_map || {};
      const rows = log.map((e) => ({
        ad_account_id: (e.account_id && map[e.account_id]) || null,
        account_id: e.account_id ?? null,
        called_at: e.called_at,
        endpoint: e.endpoint,
        status_code: e.status_code,
        error_code: e.error_code,
        error_subcode: e.error_subcode,
        error_message: e.error_message,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from("ad_account_call_log").insert(rows.slice(i, i + 100));
      }
    } catch (e) {
      console.warn("persist call log failed:", e);
    }
    clearMetaCallLog();
  }

// (We intentionally do NOT early-return when no headers were captured —
  //  callers still want a per-account row so the UI shows current call counts.)

  // 1) Per-account snapshot. We always upsert when caller provided
  //    ad_account_db_ids (so the X/Limit badge has a row to read), even if
  //    Meta didn't echo X-Ad-Account-Usage on this batch.
  if (Array.isArray(opts.ad_account_db_ids) && opts.ad_account_db_ids.length > 0) {
    let bucCall: number | undefined;
    let bucCpu: number | undefined;
    let bucTime: number | undefined;
    let bucRegain: number | undefined;
    if (snap?.buc) {
      const firstKey = Object.keys(snap.buc)[0];
      const firstEntry = firstKey ? snap.buc[firstKey]?.[0] : undefined;
      if (firstEntry) {
        bucCall = firstEntry.call_count;
        bucCpu = firstEntry.total_cputime;
        bucTime = firstEntry.total_time;
        bucRegain = firstEntry.estimated_time_to_regain_access;
      }
    }
    const tier = snap?.account?.ads_api_access_tier ?? null;
    const estLimit = estimateCallLimit(tier, 0);
    const rows = opts.ad_account_db_ids.map((id) => ({
      ad_account_id: id,
      acc_util_pct: snap?.account?.acc_id_util_pct ?? null,
      reset_seconds: snap?.account?.reset_time_duration ?? null,
      access_tier: tier,
      estimated_call_limit: estLimit,
      buc_call_count: bucCall ?? null,
      buc_cputime: bucCpu ?? null,
      buc_total_time: bucTime ?? null,
      estimated_regain_sec: bucRegain ?? null,
      updated_at: now,
    }));
    try {
      for (let i = 0; i < rows.length; i += 50) {
        await supabase
          .from("ad_account_rate_limits")
          .upsert(rows.slice(i, i + 50), { onConflict: "ad_account_id" });
      }
    } catch (e) {
      console.warn("persist ad_account_rate_limits failed:", e);
    }
  }

  // 2) Per-BM snapshot
  if (snap.buc && opts.business_manager_db_id) {
    try {
      const firstKey = Object.keys(snap.buc)[0];
      const firstEntry = firstKey ? snap.buc[firstKey]?.[0] : undefined;
      if (firstEntry) {
        await supabase.from("bm_rate_limits").upsert({
          business_manager_id: opts.business_manager_db_id,
          buc_call_count: firstEntry.call_count ?? null,
          buc_cputime: firstEntry.total_cputime ?? null,
          buc_total_time: firstEntry.total_time ?? null,
          estimated_regain_sec: firstEntry.estimated_time_to_regain_access ?? null,
          business_use_case: firstEntry.type ?? null,
          updated_at: now,
        }, { onConflict: "business_manager_id" });
      }
    } catch (e) {
      console.warn("persist bm_rate_limits failed:", e);
    }
  }

  // 3) Per-app snapshot — app_id not known here unless caller provides; skip for now.
}
