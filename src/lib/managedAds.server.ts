// Server-only helpers for managed (shared) ad accounts.

export async function tokenFor(supabaseAdmin: any, adAccountDbId: string) {
  const { decryptToken } = await import("@/lib/metaGraph.server");
  const { data: account } = await supabaseAdmin
    .from("ad_accounts")
    .select("id, account_id, account_name, business_managers(access_token, bm_id, name)")
    .eq("id", adAccountDbId)
    .maybeSingle();
  const bm = Array.isArray(account?.business_managers) ? account.business_managers[0] : account?.business_managers;
  if (!account || !bm?.access_token) throw new Error("Ad account বা Business Manager token পাওয়া যায়নি");
  // Tokens are encrypted with the backend's service key; BM_TOKEN_SECRET lets a host whose
  // SUPABASE_SERVICE_ROLE_KEY string differs still unlock them.
  const secrets = [process.env.BM_TOKEN_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean) as string[];
  let token: string | null = null;
  for (const sec of secrets) {
    try { token = await decryptToken(bm.access_token, sec); break; } catch { /* try next */ }
  }
  if (!token) {
    // Fallback: the backend that encrypted the token unlocks it for us (server-to-server).
    try {
      const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/ads-manager-campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-service-key": process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "" },
        body: JSON.stringify({ mode: "resolve_token", adAccountId: adAccountDbId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.token) token = String(j.token);
    } catch { /* fall through */ }
  }
  if (!token) throw new Error(`Business Manager "${bm.name ?? ""}"-এর token খোলা যাচ্ছে না — Business Managers পেজে এই BM-এর access token আবার সেভ করুন`);
  const act = String(account.account_id).startsWith("act_") ? account.account_id : `act_${account.account_id}`;
  return { token, act, account, bmId: bm.bm_id ? String(bm.bm_id) : null };
}

export function pageOfAd(ad: any): string | null {
  const c = ad?.creative ?? {};
  if (c.object_story_spec?.page_id) return String(c.object_story_spec.page_id);
  if (c.actor_id) return String(c.actor_id);
  const eid = c.effective_object_story_id || c.object_story_id;
  if (eid && String(eid).includes("_")) return String(eid).split("_")[0];
  return null;
}

/** Shared (wallet-charged) ad accounts assigned to a client by admin. */
export async function sharedAccountIds(supabaseAdmin: any, userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("managed_account_assignments").select("ad_account_id").eq("user_id", userId);
  return (data ?? []).map((r: any) => String(r.ad_account_id));
}

/** Client's own (dedicated) Meta ad accounts — only when Campaign Management is on. */
export async function ownAccounts(supabaseAdmin: any, userId: string) {
  const { data: prof } = await supabaseAdmin.from("profiles").select("campaign_management_enabled").eq("user_id", userId).maybeSingle();
  if (!prof?.campaign_management_enabled) return [] as any[];
  const { data: links } = await supabaseAdmin.from("user_ad_accounts").select("ad_account_id").eq("user_id", userId);
  const ids = (links ?? []).map((l: any) => l.ad_account_id);
  if (!ids.length) return [];
  const { data } = await supabaseAdmin.from("ad_accounts").select("id, account_id, account_name, platform, status").in("id", ids);
  return (data ?? []).filter((a: any) => String(a.platform || "meta").toLowerCase() !== "tiktok");
}

/**
 * Collect a user's owned campaigns/adsets/ads.
 * Shared accounts: only campaigns of the user's approved pages (these are wallet-charged).
 * includeOwn: also the user's own dedicated accounts (not wallet-charged; spend uses the account's own limit).
 */
export async function loadOwned(supabaseAdmin: any, userId: string, dateRange?: { since: string; until: string }, opts?: { includeOwn?: boolean }) {
  const { graphClient } = await import("@/lib/metaGraph.server");
  // All of the client's own pages (any not rejected). Page IDs are globally unique, so one owner per page.
  const { data: allPages } = await supabaseAdmin
    .from("client_facebook_pages")
    .select("id, page_id, page_name, ad_account_id, status")
    .eq("user_id", userId)
    .neq("status", "rejected");
  const pages = allPages ?? [];
  const { data: registry } = await supabaseAdmin.from("managed_campaigns").select("campaign_id").eq("user_id", userId);
  const registered = new Set<string>((registry ?? []).map((r: any) => String(r.campaign_id)));

  // Shared accounts the admin assigned to this client; client may run ANY of their pages on them.
  const pageIdSet = new Set<string>(pages.map((p: any) => String(p.page_id)));
  const sharedList = await sharedAccountIds(supabaseAdmin, userId);
  const byAccount = new Map<string, Set<string> | null>();
  for (const id of sharedList) byAccount.set(id, pageIdSet);
  const own = opts?.includeOwn ? await ownAccounts(supabaseAdmin, userId) : [];
  for (const a of own) if (!byAccount.has(a.id)) byAccount.set(a.id, null);

  const sharedIds = [...byAccount.entries()].filter(([, v]) => v).map(([k]) => k);
  const { data: sharedRows } = sharedIds.length
    ? await supabaseAdmin.from("ad_accounts").select("id, account_id, account_name").in("id", sharedIds)
    : { data: [] };
  const accounts = [
    ...(sharedRows ?? []).map((a: any) => ({ id: a.id, account_id: a.account_id, name: a.account_name || a.account_id, kind: "shared" as const })),
    ...own.filter((a: any) => !sharedIds.includes(a.id)).map((a: any) => ({ id: a.id, account_id: a.account_id, name: a.account_name || a.account_id, kind: "own" as const })),
  ];

  const result = { campaigns: [] as any[], adsets: [] as any[], ads: [] as any[], pages, allPages: pages, accounts, errors: [] as string[] };

  const noPerm: string[] = [];
  const tooBig: string[] = [];
  const other = new Set<string>();
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  // Meta rejects big nested requests with (#1); retry the same call with a smaller page.
  const getSmall = async (g: any, path: string, fields: string) => {
    try { return await g.get(path, { fields, limit: "100" }); }
    catch (e: any) {
      if (!/reduce the amount of data|\(#1\)/i.test(String(e?.message))) throw e;
      return await g.get(path, { fields, limit: "25" });
    }
  };

  for (const [accId, pageIds] of byAccount) {
    try {
      const { token, act } = await tokenFor(supabaseAdmin, accId);
      const g = graphClient(token);
      const [ads, adsets, camps] = await Promise.all([
        getSmall(g, `${act}/ads`, "id,name,status,effective_status,adset_id,campaign_id,created_time,creative{id,actor_id,object_story_spec,effective_object_story_id,thumbnail_url}"),
        getSmall(g, `${act}/adsets`, "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,bid_strategy,bid_amount,targeting,promoted_object,start_time,end_time,created_time"),
        getSmall(g, `${act}/campaigns`, "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time"),
      ]);
      let ownAds: any[], ownSets: any[], ownCamps: any[];
      if (pageIds === null) {
        ownAds = ads.data ?? []; ownSets = adsets.data ?? []; ownCamps = camps.data ?? [];
      } else {
        const owned = new Set<string>(registered as Set<string>);
        for (const ad of ads.data ?? []) { const pg = pageOfAd(ad); if (pg && pageIds.has(pg)) owned.add(String(ad.campaign_id)); }
        for (const s of adsets.data ?? []) { const pg = s.promoted_object?.page_id; if (pg && pageIds.has(String(pg))) owned.add(String(s.campaign_id)); }
        // An ad belonging to a foreign page inside an "owned" campaign is never exposed.
        ownAds = (ads.data ?? []).filter((a: any) => owned.has(String(a.campaign_id)) && (!pageOfAd(a) || pageIds.has(pageOfAd(a)!)));
        ownSets = (adsets.data ?? []).filter((s: any) => owned.has(String(s.campaign_id)));
        ownCamps = (camps.data ?? []).filter((c: any) => owned.has(String(c.id)));
      }

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
      const kind = pageIds === null ? "own" : "shared";
      const tag = (o: any) => ({ ...o, ad_account_db_id: accId, account_kind: kind });
      result.campaigns.push(...ownCamps.map(tag));
      result.adsets.push(...ownSets.map(tag));
      result.ads.push(...ownAds.map(({ creative, ...a }: any) => tag({ ...a, thumbnail_url: creative?.thumbnail_url, page_id: pageOfAd({ creative }) })));
    } catch (e: any) {
      const m = String(e?.message || "");
      if (/#200|ads_management|ads_read/i.test(m)) noPerm.push(accName(accId));
      else if (/reduce the amount of data|\(#1\)/i.test(m)) tooBig.push(accName(accId));
      else other.add(m || "Meta data আনা যায়নি");
    }
  }
  if (noPerm.length) result.errors.push(`${noPerm.length}টি ad account-এ আমাদের Business Manager-এর campaign দেখার/চালানোর অনুমতি নেই (${noPerm.slice(0, 3).join(", ")}${noPerm.length > 3 ? "…" : ""})। এগুলোতে ad চালাতে Admin-কে জানান।`);
  if (tooBig.length) result.errors.push(`${tooBig.length}টি account-এর data এখন Meta দিচ্ছে না — একটু পরে Refresh দিন।`);
  result.errors.push(...other);
  return result;
}

export async function walletBalance(supabaseAdmin: any, userId: string) {
  const { data } = await supabaseAdmin.from("wallets").select("balance").eq("user_id", userId).maybeSingle();
  return Number(data?.balance ?? 0);
}

