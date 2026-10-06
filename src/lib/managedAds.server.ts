// Server-only helpers for managed (shared) ad accounts.

export async function tokenFor(supabaseAdmin: any, adAccountDbId: string) {
  const { decryptToken } = await import("@/lib/metaGraph.server");
  const { data: account } = await supabaseAdmin
    .from("ad_accounts")
    .select("id, account_id, account_name, business_managers(access_token)")
    .eq("id", adAccountDbId)
    .maybeSingle();
  const bm = Array.isArray(account?.business_managers) ? account.business_managers[0] : account?.business_managers;
  if (!account || !bm?.access_token) throw new Error("Ad account বা Business Manager token পাওয়া যায়নি");
  const token = await decryptToken(bm.access_token, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const act = String(account.account_id).startsWith("act_") ? account.account_id : `act_${account.account_id}`;
  return { token, act, account };
}

export function pageOfAd(ad: any): string | null {
  const c = ad?.creative ?? {};
  if (c.object_story_spec?.page_id) return String(c.object_story_spec.page_id);
  if (c.actor_id) return String(c.actor_id);
  const eid = c.effective_object_story_id || c.object_story_id;
  if (eid && String(eid).includes("_")) return String(eid).split("_")[0];
  return null;
}

/** Collect a user's owned campaigns/adsets/ads across approved pages. */
export async function loadOwned(supabaseAdmin: any, userId: string, dateRange?: { since: string; until: string }) {
  const { graphClient } = await import("@/lib/metaGraph.server");
  const { data: pages } = await supabaseAdmin
    .from("client_facebook_pages")
    .select("id, page_id, page_name, ad_account_id")
    .eq("user_id", userId)
    .eq("status", "approved");
  const { data: registry } = await supabaseAdmin.from("managed_campaigns").select("campaign_id").eq("user_id", userId);
  const registered = new Set<string>((registry ?? []).map((r: any) => String(r.campaign_id)));

  const byAccount = new Map<string, Set<string>>();
  for (const p of pages ?? []) {
    if (!p.ad_account_id) continue;
    if (!byAccount.has(p.ad_account_id)) byAccount.set(p.ad_account_id, new Set());
    byAccount.get(p.ad_account_id)!.add(String(p.page_id));
  }

  const result = { campaigns: [] as any[], adsets: [] as any[], ads: [] as any[], pages: pages ?? [], errors: [] as string[] };

  for (const [accId, pageIds] of byAccount) {
    try {
      const { token, act } = await tokenFor(supabaseAdmin, accId);
      const g = graphClient(token);
      const [ads, adsets, camps] = await Promise.all([
        g.get(`${act}/ads`, { fields: "id,name,status,effective_status,adset_id,campaign_id,created_time,creative{id,actor_id,object_story_spec,effective_object_story_id,thumbnail_url}", limit: "500" }),
        g.get(`${act}/adsets`, { fields: "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,bid_strategy,bid_amount,targeting,promoted_object,start_time,end_time,created_time", limit: "500" }),
        g.get(`${act}/campaigns`, { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time", limit: "500" }),
      ]);
      const owned = new Set<string>(registered as Set<string>);
      for (const ad of ads.data ?? []) { const pg = pageOfAd(ad); if (pg && pageIds.has(pg)) owned.add(String(ad.campaign_id)); }
      for (const s of adsets.data ?? []) { const pg = s.promoted_object?.page_id; if (pg && pageIds.has(String(pg))) owned.add(String(s.campaign_id)); }
      // An ad belonging to a foreign page inside an "owned" campaign is never exposed.
      const ownAds = (ads.data ?? []).filter((a: any) => owned.has(String(a.campaign_id)) && (!pageOfAd(a) || pageIds.has(pageOfAd(a)!)));
      const ownSets = (adsets.data ?? []).filter((s: any) => owned.has(String(s.campaign_id)));
      const ownCamps = (camps.data ?? []).filter((c: any) => owned.has(String(c.id)));

      if (dateRange && ownCamps.length) {
        const tr = JSON.stringify(dateRange);
        const fields = "spend,impressions,reach,clicks,cpc,ctr,cpm,actions,cost_per_action_type";
        const [ci, si, ai] = await Promise.all(
          (["campaign", "adset", "ad"] as const).map((level) =>
            g.get(`${act}/insights`, { level, fields: `${level}_id,${fields}`, time_range: tr, limit: "500" }).catch(() => ({ data: [] })),
          ),
        );
        const map = (rows: any[], key: string) => new Map(rows.map((r: any) => [String(r[key]), r]));
        const cm = map(ci.data ?? [], "campaign_id"), sm = map(si.data ?? [], "adset_id"), am = map(ai.data ?? [], "ad_id");
        ownCamps.forEach((c: any) => (c.insights = cm.get(String(c.id))));
        ownSets.forEach((s: any) => (s.insights = sm.get(String(s.id))));
        ownAds.forEach((a: any) => (a.insights = am.get(String(a.id))));
      }
      const tag = (o: any) => ({ ...o, ad_account_db_id: accId });
      result.campaigns.push(...ownCamps.map(tag));
      result.adsets.push(...ownSets.map(tag));
      result.ads.push(...ownAds.map(({ creative, ...a }: any) => tag({ ...a, thumbnail_url: creative?.thumbnail_url, page_id: pageOfAd({ creative }) })));
    } catch (e: any) {
      result.errors.push(e?.message || "Meta data আনা যায়নি");
    }
  }
  return result;
}

export async function walletBalance(supabaseAdmin: any, userId: string) {
  const { data } = await supabaseAdmin.from("wallets").select("balance").eq("user_id", userId).maybeSingle();
  return Number(data?.balance ?? 0);
}

