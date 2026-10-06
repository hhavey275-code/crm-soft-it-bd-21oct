// Server-only: charge managed-ads spend to client wallets and auto-pause on low balance.
import { tokenFor, loadOwned, walletBalance } from "@/lib/managedAds.server";
import { graphClient } from "@/lib/metaGraph.server";

export async function getManagedSettings(supabaseAdmin: any) {
  const { data } = await supabaseAdmin.from("managed_ads_settings").select("pause_threshold, low_balance_alert").eq("id", 1).maybeSingle();
  return { pauseThreshold: Number(data?.pause_threshold ?? 1), lowBalanceAlert: Number(data?.low_balance_alert ?? 10) };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Charge new spend for one client, then pause everything if wallet is at/below threshold. */
export async function syncClientSpend(supabaseAdmin: any, userId: string, pauseThreshold: number) {
  const owned = await loadOwned(supabaseAdmin, userId);
  const { data: pages } = await supabaseAdmin
    .from("client_facebook_pages").select("approved_at").eq("user_id", userId).eq("status", "approved");
  const firstApproved = (pages ?? []).map((p: any) => p.approved_at).filter(Boolean).sort()[0];

  const yesterday = new Date(Date.now() - 86400000);
  const sinceDate = firstApproved && new Date(firstApproved) > yesterday ? new Date(firstApproved) : yesterday;
  const since = ymd(sinceDate);
  const until = ymd(new Date(Date.now() + 86400000)); // covers accounts ahead of UTC

  const byAccount = new Map<string, any[]>();
  for (const c of owned.campaigns) {
    if (!byAccount.has(c.ad_account_db_id)) byAccount.set(c.ad_account_db_id, []);
    byAccount.get(c.ad_account_db_id)!.push(c);
  }

  let charged = 0;
  const errors: string[] = [...owned.errors];
  for (const [accId, camps] of byAccount) {
    try {
      const { token, act } = await tokenFor(supabaseAdmin, accId);
      const g = graphClient(token);
      const ids = new Set(camps.map((c) => String(c.id)));
      const names = new Map(camps.map((c) => [String(c.id), c.name]));
      const r = await g.get(`${act}/insights`, {
        level: "campaign", fields: "campaign_id,spend", time_increment: "1",
        time_range: JSON.stringify({ since, until }), limit: "500",
      });
      for (const row of r.data ?? []) {
        const cid = String(row.campaign_id);
        if (!ids.has(cid) || !(Number(row.spend) > 0)) continue;
        const { data: res, error } = await supabaseAdmin.rpc("charge_managed_spend", {
          p_user_id: userId, p_campaign_id: cid, p_date: row.date_start, p_total_spend: Number(row.spend), p_label: names.get(cid) ?? cid,
        });
        if (error) errors.push(error.message);
        else charged += Number((res as any)?.charged ?? 0);
      }
    } catch (e: any) {
      errors.push(e?.message || "spend sync failed");
    }
  }

  const balance = await walletBalance(supabaseAdmin, userId);
  let paused = 0;
  if (balance <= pauseThreshold) {
    for (const c of owned.campaigns.filter((c: any) => c.status === "ACTIVE")) {
      try {
        const { token } = await tokenFor(supabaseAdmin, c.ad_account_db_id);
        await graphClient(token).post(String(c.id), { status: "PAUSED" });
        paused++;
      } catch (e: any) {
        errors.push(e?.message || "pause failed");
      }
    }
    if (paused > 0) {
      await supabaseAdmin.from("profiles").update({ managed_ads_paused_at: new Date().toISOString() }).eq("user_id", userId);
      await supabaseAdmin.from("notifications").insert({
        user_id: userId, type: "managed_ads_paused",
        title: "Wallet balance শেষ — ad বন্ধ করা হয়েছে",
        message: `আপনার wallet-এ $${balance.toFixed(2)} আছে। ${paused}টি campaign বন্ধ করা হয়েছে। Top-up করে আবার চালু করুন।`,
      });
    }
  }
  return { charged, balance, paused, errors };
}
