// Persist Meta rate-limit headers captured by meta-fetch into DB tables.
// Called by edge functions after each Meta batch call.
import { getLastRateLimitHeaders } from "./meta-fetch.ts";

interface PersistOptions {
  ad_account_db_ids?: string[]; // ad_accounts.id (uuid) — applies same account snapshot to all
  business_manager_db_id?: string | null;
}

export async function persistMetaRateLimits(supabase: any, opts: PersistOptions) {
  const snap = getLastRateLimitHeaders();
  if (!snap || (!snap.app && !snap.account && !snap.buc)) return;

  const now = new Date().toISOString();

  // 1) Per-account snapshot (X-Ad-Account-Usage). Same value applied to every
  //    account in this batch since Meta returns one header for the whole call.
  if (snap.account && Array.isArray(opts.ad_account_db_ids) && opts.ad_account_db_ids.length > 0) {
    // Pick the first BUC entry for additional metrics if present
    let bucCall: number | undefined;
    let bucCpu: number | undefined;
    let bucTime: number | undefined;
    let bucRegain: number | undefined;
    if (snap.buc) {
      const firstKey = Object.keys(snap.buc)[0];
      const firstEntry = firstKey ? snap.buc[firstKey]?.[0] : undefined;
      if (firstEntry) {
        bucCall = firstEntry.call_count;
        bucCpu = firstEntry.total_cputime;
        bucTime = firstEntry.total_time;
        bucRegain = firstEntry.estimated_time_to_regain_access;
      }
    }
    const rows = opts.ad_account_db_ids.map((id) => ({
      ad_account_id: id,
      acc_util_pct: snap.account?.acc_id_util_pct ?? null,
      reset_seconds: snap.account?.reset_time_duration ?? null,
      access_tier: snap.account?.ads_api_access_tier ?? null,
      buc_call_count: bucCall ?? null,
      buc_cputime: bucCpu ?? null,
      buc_total_time: bucTime ?? null,
      estimated_regain_sec: bucRegain ?? null,
      updated_at: now,
    }));
    try {
      // Upsert in chunks of 50
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
