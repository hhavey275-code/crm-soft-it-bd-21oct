import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { tokenFor, loadOwned, walletBalance, ownAccounts, sharedAccountIds } from "@/lib/managedAds.server";

/**
 * Managed (shared ad account) Ads Manager API.
 * Clients only ever see/touch campaigns that belong to their approved Facebook pages.
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), dateFrom: z.string().regex(dateRe), dateTo: z.string().regex(dateRe), asUserId: z.string().uuid().optional(), adAccountDbId: z.string().uuid().optional() }),
  z.object({ action: z.literal("accounts"), asUserId: z.string().uuid().optional() }),
  z.object({ action: z.literal("set_status"), level: z.enum(["campaign", "adset", "ad"]), objectId: z.string().regex(/^\d+$/), status: z.enum(["ACTIVE", "PAUSED"]), asUserId: z.string().uuid().optional(), adAccountDbId: z.string().uuid().optional() }),
  z.object({
    action: z.literal("update"), level: z.enum(["campaign", "adset", "ad"]), objectId: z.string().regex(/^\d+$/),
    adAccountDbId: z.string().uuid().optional(), asUserId: z.string().uuid().optional(),
    name: z.string().min(1).max(200).optional(),
    budgetType: z.enum(["daily", "lifetime"]).optional(), amount: z.number().positive().max(1000000).optional(),
    countries: z.array(z.string().length(2)).min(1).max(25).optional(),
    ageMin: z.number().int().min(18).max(65).optional(), ageMax: z.number().int().min(18).max(65).optional(),
    message: z.string().max(5000).optional(), headline: z.string().max(255).optional(), link: z.string().max(1000).optional(),
    startTime: z.string().max(40).optional(), endTime: z.string().max(40).optional(),
  }),
  z.object({ action: z.literal("set_budget"), objectId: z.string().regex(/^\d+$/), budgetType: z.enum(["daily", "lifetime"]), amount: z.number().positive().max(1000000), asUserId: z.string().uuid().optional(), adAccountDbId: z.string().uuid().optional() }),
  z.object({ action: z.literal("interests"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid().optional(), q: z.string().min(2).max(60) }),
  z.object({ action: z.literal("pixels"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("page_info"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("fb_status") }),
  z.object({ action: z.literal("account_summary"), ids: z.array(z.string().uuid()).min(1).max(60), asUserId: z.string().uuid().optional() }),
  z.object({ action: z.literal("demographics"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid().optional(), q: z.string().max(60).optional() }),
  z.object({ action: z.literal("posts"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("request_page_access"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({
    action: z.literal("create"),
    pageDbId: z.string().uuid(),
    adAccountDbId: z.string().uuid().optional(),
    objective: z.enum(["SALES", "LEADS", "MESSAGES", "TRAFFIC", "ENGAGEMENT", "AWARENESS"]),
    conversionLocation: z.enum(["WEBSITE", "MESSAGING"]).default("WEBSITE"),
    budgetLevel: z.enum(["campaign", "adset"]).default("adset"),
    startTime: z.string().optional(),
    cta: z.enum(["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "ORDER_NOW", "BUY_NOW", "CONTACT_US", "SEND_MESSAGE", "MESSAGE_PAGE", "GET_OFFER", "BOOK_TRAVEL", "SEE_MORE"]).optional(),
    specialCategories: z.array(z.enum(["CREDIT", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES"])).max(5).default([]),
    pixelId: z.string().regex(/^\d+$/).optional(),
    customEvent: z.enum(["PURCHASE", "ADD_TO_CART", "INITIATE_CHECKOUT", "LEAD", "COMPLETE_REGISTRATION", "CONTACT", "VIEW_CONTENT"]).optional(),
    campaignName: z.string().min(1).max(200),
    adsetName: z.string().min(1).max(200),
    adName: z.string().min(1).max(200),
    budgetType: z.enum(["daily", "lifetime"]),
    amount: z.number().min(1).max(100000),
    endTime: z.string().optional(),
    bidStrategy: z.enum(["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP"]),
    bidAmount: z.number().positive().optional(),
    countries: z.array(z.string().length(2)).min(1).max(25),
    ageMin: z.number().int().min(18).max(65),
    ageMax: z.number().int().min(18).max(65),
    genders: z.array(z.union([z.literal(1), z.literal(2)])).max(2),
    interests: z.array(z.object({ id: z.string(), name: z.string(), type: z.string().max(40).optional() })).max(25),
    existingPostId: z.string().max(80).optional(),
    message: z.string().max(5000).optional(),
    headline: z.string().max(255).optional(),
    link: z.string().max(1000).optional(),
    imageBase64: z.string().max(8_000_000).optional(),
    engagementLocation: z.enum(["ON_AD", "MESSAGING", "WEBSITE", "CALLS"]).optional(),
    msgDestinations: z.array(z.enum(["MESSENGER", "WHATSAPP"])).max(2).optional(),
    whatsappNumber: z.string().max(30).optional(),
    phoneNumber: z.string().max(30).optional(),
    publish: z.boolean(),
  }),
]);

type Body = z.infer<typeof schema>;

// Verify the browser's login with the project's public URL + anon key (works on every host,
// independent of server env names).
async function verifyUser(token: string): Promise<{ id: string } | null> {
  if (!token) return null;
  const url = "https://dhswrfzdqcavgmymllat.supabase.co";
  const keys = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s",
    process.env.SUPABASE_PUBLISHABLE_KEY,
  ].filter(Boolean) as string[];
  for (const key of keys) {
    try {
      const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      if (r.ok) { const u: any = await r.json().catch(() => null); if (u?.id) return { id: String(u.id) }; }
    } catch { /* next */ }
  }
  return null;
}

async function ctx(request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const user = await verifyUser(auth.slice(7).trim());
  if (!user) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", user.id);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "superadmin");
  return { supabaseAdmin, user, isAdmin };
}

// Page key the client saved via Facebook login (any CRM user who connected that page).
async function savedPageToken(supabaseAdmin: any, pageId: string, preferUser?: string): Promise<string | undefined> {
  try {
    const { data } = await supabaseAdmin.from("client_page_tokens").select("access_token,user_id").eq("page_id", pageId).limit(10);
    const rows = (data ?? []).sort((a: any, b: any) => (a.user_id === preferUser ? -1 : 0) - (b.user_id === preferUser ? -1 : 0));
    const { decryptToken } = await import("@/lib/metaGraph.server");
    for (const row of rows) for (const sec of [process.env.BM_TOKEN_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean) as string[]) {
      try { return await decryptToken(row.access_token, sec); } catch { /* next */ }
    }
  } catch { /* none */ }
  return undefined;
}

// Give our Business Manager "Advertise" rights on the client's Page using the client's saved Page login.
// Returns a plain-language problem when Facebook refuses, so the client knows exactly what to do.
async function ensurePageAccess(g: any, supabaseAdmin: any, pageId: string, ownerId: string, bmId?: string | null): Promise<string | null> {
  const pt = await savedPageToken(supabaseAdmin, pageId, ownerId);
  const v = "https://graph.facebook.com/v25.0";
  const tasks = ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MODERATE", "MESSAGING"];
  if (!pt) return "এই Page-এর Facebook login CRM-এ save নেই — My Ads-এ \"Facebook আবার connect\" চেপে Page-টা টিক দিয়ে login করুন, তারপর আবার Publish দিন";
  if (!bmId) return "এই ad account-এর Business Manager CRM-এ পাওয়া যায়নি";
  const already = await fetch(`${v}/${pageId}/agencies?fields=id&access_token=${encodeURIComponent(pt)}`).then((r) => r.json()).catch(() => null);
  if ((already?.data ?? []).some((a: any) => String(a.id) === String(bmId))) {
    const me = await g.get("me", { fields: "id" }).catch(() => null);
    if (me?.id) await g.post(`${pageId}/assigned_users`, { user: String(me.id), tasks: JSON.stringify(tasks), business: String(bmId) }).catch(() => null);
    return null;
  }
  const r: any = await fetch(`${v}/${pageId}/agencies`, { method: "POST", body: new URLSearchParams({ business: String(bmId), permitted_tasks: JSON.stringify(tasks), access_token: pt }) }).then((x) => x.json()).catch(() => null);
  if (r && !r.error) {
    const me = await g.get("me", { fields: "id" }).catch(() => null);
    if (me?.id) await g.post(`${pageId}/assigned_users`, { user: String(me.id), tasks: JSON.stringify(tasks), business: String(bmId) }).catch(() => null);
    return null;
  }
  const e = r?.error ?? {};
  const bm = await g.get(String(bmId), { fields: "name" }).catch(() => null);
  const bmName = bm?.name ? `"${String(bm.name).trim()}"` : "এই ad account-এর";
  // Page belongs to another Business: send a request and point the owner to that exact Business's Requests page.
  await g.post(`${bmId}/client_pages`, { page_id: pageId, permitted_tasks: ["ADVERTISE", "ANALYZE", "CREATE_CONTENT"] }).catch(() => null);
  const pb = await fetch(`${v}/${pageId}?fields=business{id,name}&access_token=${encodeURIComponent(pt)}`).then((x) => x.json()).catch(() => null);
  const owner = pb?.business;
  const where = owner?.id
    ? `Page-টা "${owner.name}" Business-এর মালিকানায়। এই লিংকে গিয়ে ${bmName} এর request-এ Approve চাপুন: https://business.facebook.com/latest/settings/requests?business_id=${owner.id}`
    : `Facebook-এ Page-এর Settings → Page access → Partner requests-এ গিয়ে ${bmName} এর request Approve করুন: https://www.facebook.com/settings/?tab=profile_access`;
  const restricted = e.error_subcode === 2446325 ? " (Facebook বলছে Page-এর মালিক Business-এর ad চালানোর অনুমতিতে সমস্যা আছে, তাই নিজে থেকে দেওয়া যায়নি)" : ` (${e.error_user_msg || e.message || "অনুমতি নেই"})`;
  return `Page-টা এখনো এই ad account-এর Business Manager-এ access পায়নি${restricted}। ${where} — একবার Approve করলেই এই Page দিয়ে বারবার ad চালানো যাবে`;
}

async function handle(body: Body, c: NonNullable<Awaited<ReturnType<typeof ctx>>>) {
  const { supabaseAdmin, user, isAdmin } = c;
  const targetUser = "asUserId" in body && body.asUserId && isAdmin ? body.asUserId : user.id;
  const { graphClient } = await import("@/lib/metaGraph.server");

  if (body.action === "fb_status") {
    const { data } = await (supabaseAdmin as any).from("client_page_tokens").select("page_id").eq("user_id", targetUser).limit(1);
    if (!data?.length) return { connected: false, hasToken: false };
    const tok = await savedPageToken(supabaseAdmin, String(data[0].page_id), targetUser);
    if (!tok) return { connected: false, hasToken: true };
    const r = await fetch(`https://graph.facebook.com/v25.0/me?fields=id,name&access_token=${encodeURIComponent(tok)}`).then((x) => x.json()).catch(() => null);
    return { connected: !!r?.id, hasToken: true };
  }

  const { getManagedSettings } = await import("@/lib/managedSpend.server");
  const settings = await getManagedSettings(supabaseAdmin);

  if (body.action === "account_summary") {
    // Per-account Meta status + active campaign count for the account picker.
    const shared = new Set(await sharedAccountIds(supabaseAdmin, targetUser));
    const own = new Set((await ownAccounts(supabaseAdmin, targetUser, true, isAdmin && targetUser === user.id)).map((a: any) => a.id));
    const ids = body.ids.filter((id) => shared.has(id) || own.has(id));
    const { data: reg } = await supabaseAdmin.from("managed_campaigns").select("campaign_id").eq("user_id", targetUser);
    const mine = new Set((reg ?? []).map((r: any) => String(r.campaign_id)));
    const out: Record<string, any> = {};
    const one = async (id: string) => {
      try {
        const { token, act } = await tokenFor(supabaseAdmin, id);
        const g = graphClient(token);
        const [info, camps] = await Promise.all([
          g.get(act, { fields: "account_status,disable_reason,balance,amount_spent,spend_cap,currency" }),
          g.get(`${act}/campaigns`, { fields: "id", effective_status: JSON.stringify(["ACTIVE"]), limit: "200" }).catch(() => null),
        ]);
        let list: any[] = camps?.data ?? [];
        if (shared.has(id) && !own.has(id) && !isAdmin) list = list.filter((c) => mine.has(String(c.id)));
        out[id] = { status: Number(info?.account_status), disableReason: Number(info?.disable_reason || 0), active: camps ? list.length : null,
          balance: Number(info?.balance || 0) / 100, spendCap: Number(info?.spend_cap || 0) / 100, amountSpent: Number(info?.amount_spent || 0) / 100, currency: info?.currency || "USD" };
      } catch (e: any) { out[id] = { error: String(e?.message || "error").slice(0, 120) }; }
    };
    for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(one));
    return { summary: out };
  }

  if (body.action === "accounts") {
    // Fast account list from CRM only (no Meta calls) for the account picker.
    const sharedIds = await sharedAccountIds(supabaseAdmin, targetUser);
    const own = await ownAccounts(supabaseAdmin, targetUser, true, isAdmin && targetUser === user.id);
    const { data: sharedRows } = sharedIds.length
      ? await supabaseAdmin.from("ad_accounts").select("id, account_id, account_name").in("id", sharedIds)
      : { data: [] as any[] };
    const accounts = [
      ...(sharedRows ?? []).map((a: any) => ({ id: a.id, account_id: a.account_id, name: a.account_name || a.account_id, kind: "shared" })),
      ...own.filter((a: any) => !sharedIds.includes(a.id)).map((a: any) => ({ id: a.id, account_id: a.account_id, name: a.account_name || a.account_id, kind: "own" })),
    ];
    return { accounts };
  }

  if (body.action === "list") {
    const { error: keyErr } = await supabaseAdmin.from("ad_accounts").select("id", { head: true, count: "exact" });
    if (keyErr) {
      const { describeKey } = await import("@/lib/serverKey");
      const k = describeKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
      const why = k.role === "anon" || k.role === "publishable" ? "এটা anon/public key, service_role key না"
        : k.role === "unknown" ? `key-এর ধরন চেনা যাচ্ছে না (${k.length} অক্ষর, শুরু "${k.startsWith}…") — পুরো key কপি হয়নি বা ভুল জিনিস বসানো হয়েছে`
        : k.projectRef && k.projectRef !== "dhswrfzdqcavgmymllat" ? "key-টা অন্য Supabase project-এর" : `সার্ভার বলছে: ${keyErr.message || keyErr.code || "অনুমতি নেই"}`;
      throw new Error(`সার্ভারের গোপন key (SUPABASE_SERVICE_ROLE_KEY) ঠিক নেই — ${why}। Vercel-এ সঠিক service_role key বসিয়ে Redeploy করুন`);
    }
    const data = await loadOwned(supabaseAdmin, targetUser, { since: body.dateFrom, until: body.dateTo }, { includeOwn: true, viewAllOwn: true, allForAdmin: isAdmin && targetUser === user.id, onlyAccount: body.adAccountDbId ?? "first" });
    return { ...data, ...settings, walletBalance: await walletBalance(supabaseAdmin, targetUser), fetchedAt: new Date().toISOString() };
  }

  if (body.action === "set_status" || body.action === "set_budget" || body.action === "update") {
    const owned = await loadOwned(supabaseAdmin, targetUser, undefined, { includeOwn: true, viewAllOwn: true, allForAdmin: isAdmin && targetUser === user.id, onlyAccount: body.adAccountDbId });
    const lvl = body.action === "set_budget" ? "adset" : body.level;
    const list = lvl === "campaign" ? owned.campaigns : lvl === "adset" ? owned.adsets : owned.ads;
    const obj = list.find((o: any) => String(o.id) === body.objectId);
    if (!obj) throw new Error("এই campaign/ad আপনার নয়");
    const shared = obj.account_kind !== "own"; // own accounts spend their own limit, not the wallet
    const bal = await walletBalance(supabaseAdmin, targetUser);
    if (shared && body.action === "set_status" && body.status === "ACTIVE" && bal <= settings.pauseThreshold) {
      throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — আগে top-up করুন, তারপর চালু করুন`);
    }
    if (body.action === "update") {
      const g = graphClient((await tokenFor(supabaseAdmin, obj.ad_account_db_id)).token);
      if (shared && !isAdmin && body.amount && body.amount > bal) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — এর বেশি budget দেওয়া যাবে না`);
      const upd: Record<string, unknown> = {};
      if (body.name) upd.name = body.name;
      if (body.amount && body.budgetType && lvl !== "ad") upd[body.budgetType === "daily" ? "daily_budget" : "lifetime_budget"] = String(Math.round(body.amount * 100));
      if (lvl === "adset" && body.startTime) upd.start_time = body.startTime;
      if (lvl === "adset" && body.endTime) upd.end_time = body.endTime;
      if (lvl === "adset" && (body.countries || body.ageMin || body.ageMax)) {
        const t: any = { ...(obj.targeting ?? {}) };
        if (body.countries) t.geo_locations = { countries: body.countries, location_types: ["home", "recent"] };
        if (body.ageMin) t.age_min = body.ageMin;
        if (body.ageMax) t.age_max = body.ageMax;
        upd.targeting = t;
      }
      if (lvl === "ad" && (body.message !== undefined || body.headline !== undefined || body.link !== undefined)) {
        const cur = await g.get(body.objectId, { fields: "creative{object_story_spec,name}" });
        const spec: any = cur?.creative?.object_story_spec;
        if (!spec?.link_data) throw new Error("এই ad-টি page-এর পুরনো post থেকে বানানো — এর লেখা বদলানো যায় না, নাম/চালু-বন্ধ বদলানো যাবে");
        const ld = { ...spec.link_data };
        if (body.message !== undefined) ld.message = body.message;
        if (body.headline !== undefined) ld.name = body.headline;
        if (body.link && /^https?:\/\//.test(body.link)) { ld.link = body.link; if (ld.call_to_action?.value?.link) ld.call_to_action = { ...ld.call_to_action, value: { ...ld.call_to_action.value, link: body.link } }; }
        delete ld.image_url; delete ld.picture;
        const act = `act_${String(owned.accounts.find((a: any) => a.id === obj.ad_account_db_id)?.account_id ?? "").replace(/^act_/, "")}`;
        const cr = await g.post(`${act}/adcreatives`, { name: `${cur.creative?.name ?? "ad"} (edited)`, object_story_spec: { ...spec, link_data: ld } });
        upd.creative = { creative_id: String(cr.id) };
      }
      if (!Object.keys(upd).length) throw new Error("কিছু বদলানো হয়নি");
      await g.post(body.objectId, upd);
      return { ok: true };
    }
    if (body.action === "set_budget") {
      if (shared && !isAdmin && body.amount > bal) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — এর বেশি budget দেওয়া যাবে না`);
    }
    const { token } = await tokenFor(supabaseAdmin, obj.ad_account_db_id);
    const g = graphClient(token);
    if (body.action === "set_status") await g.post(body.objectId, { status: body.status });
    else await g.post(body.objectId, { [body.budgetType === "daily" ? "daily_budget" : "lifetime_budget"]: String(Math.round(body.amount * 100)) });
    return { ok: true };
  }

  // interests + create need an approved page owned by the caller
  const { data: page } = await supabaseAdmin.from("client_facebook_pages").select("*").eq("id", body.pageDbId).maybeSingle();
  if (!page || page.status === "rejected" || (page.user_id !== user.id && !isAdmin)) {
    throw new Error("এই page আপনার নয় বা বাতিল হয়েছে");
  }
  // Which ad account? Shared = an account admin assigned to this client (wallet-charged), any of their pages.
  // Own = one of the client's dedicated accounts (Campaign Management on).
  const wantAcc = body.adAccountDbId;
  if (!wantAcc) throw new Error("Ad account বাছুন");
  let shared: boolean;
  if ((await sharedAccountIds(supabaseAdmin, page.user_id)).includes(wantAcc)) shared = true;
  else if ((await ownAccounts(supabaseAdmin, page.user_id, true, isAdmin)).some((a: any) => a.id === wantAcc)) shared = false;
  else throw new Error("এই ad account আপনাকে দেওয়া হয়নি");
  const { token, act, bmId } = await tokenFor(supabaseAdmin, wantAcc);
  const g = graphClient(token);
  const pageId = String(page.page_id);

  if (body.action === "page_info") {
    // Ask each field separately: one unsupported field would make Facebook reject the whole request.
    const pt = await savedPageToken(supabaseAdmin, pageId, page.user_id);
    const clients = [pt ? graphClient(pt) : null, g].filter(Boolean) as any[];
    const one = async (field: string) => {
      for (const c of clients) { const r = await c.get(pageId, { fields: field }).catch(() => null); if (r && r[field.split("{")[0]] != null) return r; }
      return null;
    };
    const [wa1, wa2, ph, pic, nm] = await Promise.all([one("whatsapp_number"), one("whatsapp_display_number"), one("phone"), one("picture{url}"), one("name")]);
    let picture = pic?.picture?.data?.url ?? null;
    if (!picture) picture = `https://graph.facebook.com/${pageId}/picture?type=normal`;
    let wa = wa1?.whatsapp_number || wa2?.whatsapp_display_number || null;
    if (!wa) {
      const cta = await one("call_to_actions{type}");
      const w = (cta?.call_to_actions?.data ?? []).find((x: any) => /WHATSAPP/i.test(String(x.type)));
      if (w) wa = w.intl_number_with_plus || "linked";
    }
    return { name: nm?.name ?? page.page_name, whatsappNumber: wa ? String(wa) : null, phone: ph?.phone ?? null, picture, pageTokenMissing: !pt };
  }

  if (body.action === "pixels") {
    const r = await g.get(`${act}/adspixels`, { fields: "id,name,last_fired_time", limit: "50" });
    return { pixels: (r.data ?? []).map((x: any) => ({ id: String(x.id), name: x.name, lastFired: x.last_fired_time ?? null })) };
  }

  if (body.action === "posts") {
    // Reading posts needs the page's own token, which our Business Manager gets once the page shares access with it.
    let pageToken: string | undefined;
    pageToken = await savedPageToken(supabaseAdmin, pageId, page.user_id);
    // 2) Business Manager's shared Page access.
    if (!pageToken) { try { pageToken = (await g.get(pageId, { fields: "access_token" })).access_token; } catch { /* no access */ } }
    if (!pageToken) return { posts: [], needsAccess: true };
    const pg = graphClient(pageToken);
    const f = { fields: "id,message,full_picture,created_time,permalink_url", limit: "30" };
    const r = await pg.get(`${pageId}/published_posts`, f).catch(() => pg.get(`${pageId}/posts`, f));
    return { posts: (r.data ?? []).map((x: any) => ({ id: String(x.id), message: x.message ?? "", picture: x.full_picture ?? null, created: x.created_time, link: x.permalink_url })) };
  }

  if (body.action === "request_page_access") {
    if (!bmId) throw new Error("Business Manager ID পাওয়া যায়নি");
    await g.post(`${bmId}/client_pages`, { page_id: pageId, permitted_tasks: ["ADVERTISE", "ANALYZE", "CREATE_CONTENT"] });
    return { ok: true };
  }

  if (body.action === "demographics") {
    const out: any[] = [];
    for (const cls of ["demographics", "behaviors", "life_events", "family_statuses", "education_statuses", "income"]) {
      const r = await g.get("search", { type: "adTargetingCategory", class: cls, limit: "300" }).catch(() => ({ data: [] }));
      for (const i of r.data ?? []) out.push({ id: String(i.id), name: i.name, type: i.type || cls, path: (i.path ?? []).join(" › "), audience: i.audience_size_upper_bound });
    }
    const q = (body.q ?? "").toLowerCase();
    return { items: (q ? out.filter((i) => `${i.name} ${i.path}`.toLowerCase().includes(q)) : out).slice(0, 200) };
  }

  if (body.action === "interests") {
    const r = await g.get("search", { type: "adinterest", q: body.q, limit: "20" });
    return { interests: (r.data ?? []).map((i: any) => ({ id: String(i.id), name: i.name, audience: i.audience_size_upper_bound })) };
  }

  // ---- create ----
  const bal = await walletBalance(supabaseAdmin, page.user_id);
  if (shared && !isAdmin && body.amount > bal) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — এর বেশি budget দেওয়া যাবে না`);
  if (shared && body.publish && bal <= settings.pauseThreshold) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — আগে top-up করুন`);
  if (body.budgetType === "lifetime" && !body.endTime) throw new Error("Lifetime budget-এর জন্য শেষ তারিখ দিন");
  if (body.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && !body.bidAmount) throw new Error("Bid amount দিন");
  if (body.existingPostId && !body.existingPostId.startsWith(`${page.page_id}_`) && !/^\d+$/.test(body.existingPostId)) {
    throw new Error("Post টি এই page-এর নয়");
  }

  const status = body.publish ? "ACTIVE" : "PAUSED";
  const msging = (body.objective === "SALES" || body.objective === "LEADS") && body.conversionLocation === "MESSAGING";
  const base = {
    SALES: { objective: "OUTCOME_SALES", goal: "OFFSITE_CONVERSIONS", destination: "WEBSITE", cta: "SHOP_NOW" },
    LEADS: { objective: "OUTCOME_LEADS", goal: "OFFSITE_CONVERSIONS", destination: "WEBSITE", cta: "SIGN_UP" },
    MESSAGES: { objective: "OUTCOME_ENGAGEMENT", goal: "CONVERSATIONS", destination: "MESSENGER", cta: "MESSAGE_PAGE" },
    TRAFFIC: { objective: "OUTCOME_TRAFFIC", goal: "LINK_CLICKS", destination: "WEBSITE", cta: "LEARN_MORE" },
    ENGAGEMENT: { objective: "OUTCOME_ENGAGEMENT", goal: "POST_ENGAGEMENT", destination: "ON_POST", cta: "" },
    AWARENESS: { objective: "OUTCOME_AWARENESS", goal: "REACH", destination: "", cta: "LEARN_MORE" },
  }[body.objective];
  const eng = body.objective === "ENGAGEMENT" ? (body.engagementLocation ?? "ON_AD") : null;
  const dests = body.msgDestinations?.length ? body.msgDestinations : ["MESSENGER"];
  const msgDest = dests.length === 2 ? "MESSAGING_MESSENGER_WHATSAPP" : dests[0];
  let map: { objective: string; goal: string; destination: string; cta: string } = msging ? { ...base, goal: "CONVERSATIONS", destination: "MESSENGER", cta: "MESSAGE_PAGE" } : base;
  if (eng === "MESSAGING") map = { ...base, goal: "CONVERSATIONS", destination: msgDest, cta: "MESSAGE_PAGE" };
  if (eng === "WEBSITE") map = { ...base, goal: "LINK_CLICKS", destination: "WEBSITE", cta: "LEARN_MORE" };
  if (eng === "CALLS") map = { ...base, goal: "QUALITY_CALL", destination: "PHONE_CALL", cta: "CALL_NOW" };
  const isMsg = ["MESSENGER", "WHATSAPP", "MESSAGING_MESSENGER_WHATSAPP"].includes(map.destination);
  const waOnly = map.destination === "WHATSAPP";
  if (eng === "CALLS" && !body.phoneNumber) throw new Error("Call-এর জন্য phone number দিন");
  if (eng === "WEBSITE" && !body.existingPostId && !/^https?:\/\//.test(body.link || "")) throw new Error("Website URL দিন (https://...)");
  const pixelNeeded = (body.objective === "SALES" || body.objective === "LEADS") && !msging;
  if (eng === "ON_AD" && !body.existingPostId) throw new Error("Engagement-এর জন্য page-এর একটি post বাছুন");
  if (pixelNeeded && (!body.pixelId || !body.customEvent)) throw new Error("Website conversion-এর জন্য Dataset (Pixel) ও conversion event বাছুন");
  if ((pixelNeeded || body.objective === "TRAFFIC") && !body.existingPostId && !/^https?:\/\//.test(body.link || "")) throw new Error("Website URL দিন (https://...)");

  const cents = String(Math.round(body.amount * 100));
  const budgetKey = body.budgetType === "daily" ? "daily_budget" : "lifetime_budget";
  const cbo = body.budgetLevel === "campaign";

  // Before creating anything: the ad account must be active and our Business must be able to use the Page.
  const accInfo = await g.get(act, { fields: "account_status,name" }).catch(() => null);
  if (accInfo && Number(accInfo.account_status) !== 1) {
    const why: Record<number, string> = { 2: "Disabled", 3: "বিল বাকি (Unsettled)", 7: "Review চলছে", 9: "Grace period", 100: "বন্ধের প্রক্রিয়ায়", 101: "Closed" };
    throw new Error(`এই ad account (${accInfo.name}) Facebook-এ চালু নেই — অবস্থা: ${why[Number(accInfo.account_status)] ?? accInfo.account_status}। অন্য একটি চালু ad account বেছে নিন বা Admin-কে জানান`);
  }
  const accessProblem = await ensurePageAccess(g, supabaseAdmin, pageId, page.user_id, bmId);

  let campaignId: string | null = null;
  let step = "Campaign";
  try {
    step = "Campaign";
    const camp = await g.post(`${act}/campaigns`, {
      name: body.campaignName, objective: map.objective, status, buying_type: "AUCTION",
      special_ad_categories: body.specialCategories,
      ...(cbo ? { [budgetKey]: cents, bid_strategy: body.bidStrategy } : { is_adset_budget_sharing_enabled: false }),
    });
    campaignId = String(camp.id);
    if (shared) {
      await supabaseAdmin.from("managed_campaigns").insert({
        user_id: page.user_id, page_id: pageId, ad_account_id: wantAcc, campaign_id: campaignId, campaign_name: body.campaignName,
      });
    }

    const targeting: Record<string, unknown> = {
      geo_locations: { countries: body.countries, location_types: ["home", "recent"] },
      age_min: Math.min(body.ageMin, body.ageMax), age_max: Math.max(body.ageMin, body.ageMax),
      targeting_automation: { advantage_audience: 0 },
    };
    if (body.genders.length === 1) targeting.genders = body.genders;
    if (body.interests.length) {
      const grp: Record<string, { id: string; name: string }[]> = {};
      for (const i of body.interests) { const k = i.type || "interests"; (grp[k] ??= []).push({ id: i.id, name: i.name }); }
      targeting.flexible_spec = [grp];
    }

    step = "Ad set";
    const adset = await g.post(`${act}/adsets`, {
      name: body.adsetName, campaign_id: campaignId, status,
      billing_event: "IMPRESSIONS", optimization_goal: map.goal,
      ...(map.destination ? { destination_type: map.destination } : {}),
      ...(cbo ? {} : { bid_strategy: body.bidStrategy, [budgetKey]: cents }),
      ...(body.bidAmount && body.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" ? { bid_amount: String(Math.round(body.bidAmount * 100)) } : {}),
      ...(body.startTime ? { start_time: body.startTime } : {}),
      ...(body.endTime ? { end_time: body.endTime } : {}),
      promoted_object: pixelNeeded ? { pixel_id: body.pixelId, custom_event_type: body.customEvent }
        : map.destination.includes("WHATSAPP") ? (body.whatsappNumber && /\d{8}/.test(body.whatsappNumber.replace(/\D/g, "")) ? { page_id: pageId, whatsapp_phone_number: body.whatsappNumber.replace(/[^\d]/g, "") } : { page_id: pageId }) : { page_id: pageId },
      targeting,
    });

    let creative: Record<string, unknown>;
    if (body.existingPostId) {
      const storyId = body.existingPostId.includes("_") ? body.existingPostId : `${pageId}_${body.existingPostId}`;
      creative = { name: `${body.adName} creative`, object_story_id: storyId };
    } else {
      let imageHash: string | undefined;
      if (body.imageBase64) {
        const up = await g.post(`${act}/adimages`, { bytes: body.imageBase64 });
        imageHash = (Object.values(up.images ?? {})[0] as any)?.hash;
      }
      // Message ads need Meta's special links, otherwise Meta says "Invalid creative for objective" (#1487891).
      const link = waOnly ? "https://api.whatsapp.com/send"
        : isMsg ? "https://fb.com/messenger_doc/"
        : body.link && /^https?:\/\//.test(body.link) ? body.link : `https://facebook.com/${pageId}`;
      const ctaType = waOnly ? "WHATSAPP_MESSAGE" : isMsg ? "MESSAGE_PAGE" : eng === "CALLS" ? "CALL_NOW" : (body.cta || map.cta || "LEARN_MORE");
      const cta: Record<string, unknown> = {
        type: ctaType,
        value: waOnly ? { app_destination: "WHATSAPP" } : isMsg ? { app_destination: "MESSENGER" } : eng === "CALLS" ? { link: `tel:${body.phoneNumber}` } : { link },
      };
      creative = {
        name: `${body.adName} creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: { link, message: body.message || "", name: body.headline || undefined, image_hash: imageHash, call_to_action: cta },
        },
      };
    }
    step = "Ad creative";
    let cr: any;
    try { cr = await g.post(`${act}/adcreatives`, creative); }
    catch (err: any) {
      // Page not yet shared with our ad token: grant access using the client's saved Page login, then retry once.
      if (!/1487202|page permission|full control|ADVERTISE|\(#100\)|\(#200\)/i.test(String(err?.message))) throw err;
      const p2 = accessProblem ?? (await ensurePageAccess(g, supabaseAdmin, pageId, page.user_id, bmId));
      if (p2) throw new Error(p2);
      cr = await g.post(`${act}/adcreatives`, creative);
    }
    step = "Ad";
    await g.post(`${act}/ads`, { name: body.adName, adset_id: adset.id, creative: { creative_id: cr.id }, status });
    return { ok: true, campaignId };
  } catch (e: any) {
    if (campaignId) {
      await g.del(campaignId);
      await supabaseAdmin.from("managed_campaigns").delete().eq("campaign_id", campaignId);
    }
    const msg = String(e?.message || "");
    let hint = "";
    if (/1487202|page permission|full control/i.test(msg)) {
      hint = accessProblem ? ` — ${accessProblem}` : "";
    } else if (/permission|actor|not authorized|\(#200\)|\(#10\)/i.test(msg)) {
      hint = " — সম্ভবত এই Page আমাদের Business Manager-এ access দেয়নি। Ad ধাপে \"Page access request পাঠান\" চাপুন।";
    }
    throw new Error(`${step} তৈরি করা যায়নি: ${msg}${hint}`);
  }
}

// Setup check: says only whether the server keys work (never their values).
async function health() {
  const url = process.env.SUPABASE_URL ?? "";
  const { describeKey } = await import("@/lib/serverKey");
  const keyInfo = describeKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
  let adAccountsVisible = 0; let readError: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin.from("ad_accounts").select("id", { count: "exact", head: true });
    if (error) readError = error.message || `code ${error.code ?? "?"}`; else adAccountsVisible = count ?? 0;
  } catch (e: any) { readError = e?.message ?? "failed"; }
  return {
    urlSet: !!url, urlMatchesProject: url.includes("dhswrfzdqcavgmymllat"),
    serviceKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY, keyRole: keyInfo.role, keyProjectMatches: keyInfo.projectRef ? keyInfo.projectRef === "dhswrfzdqcavgmymllat" : null,
    keyLength: keyInfo.length, keyStartsWith: keyInfo.startsWith, keyDots: keyInfo.dots, keyHadExtraCharacters: keyInfo.hadExtraCharacters,
    adAccountsVisible, readError,
    metaAppSet: !!process.env.META_APP_ID && !!process.env.META_APP_SECRET,
  };
}

export const Route = createFileRoute("/api/managed-ads")({
  server: {
    handlers: {
      GET: async () => Response.json(await health(), { headers: { "Cache-Control": "no-store" } }),
      POST: async ({ request }) => {
        try {
          const c = await ctx(request);
          if (!c) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const parsed = schema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return Response.json({ error: "ভুল তথ্য পাঠানো হয়েছে" }, { status: 400 });
          const out = await handle(parsed.data, c);
          return Response.json(out, { headers: { "Cache-Control": "no-store" } });
        } catch (e: any) {
          console.error("[managed-ads]", e);
          return Response.json({ error: e?.message || "কিছু একটা ভুল হয়েছে" }, { status: 400 });
        }
      },
    },
  },
});
