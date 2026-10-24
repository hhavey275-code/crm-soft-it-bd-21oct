import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { tokenFor, loadOwned, walletBalance, ownAccounts, sharedAccountIds } from "@/lib/managedAds.server";

/**
 * Managed (shared ad account) Ads Manager API.
 * Clients only ever see/touch campaigns that belong to their approved Facebook pages.
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

// Shared enums for the create payload (top-level legacy fields + per-ad-set/ad items).
const CTA_ENUM = z.enum(["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "ORDER_NOW", "BUY_NOW", "CONTACT_US", "SEND_MESSAGE", "MESSAGE_PAGE", "GET_OFFER", "BOOK_TRAVEL", "SEE_MORE", "SUBSCRIBE", "DOWNLOAD", "APPLY_NOW", "GET_QUOTE", "BOOK_NOW", "SEE_MENU", "WATCH_MORE", "GET_STARTED", "INQUIRE_NOW", "REQUEST_TIME", "DONATE_NOW", "GET_SHOWTIMES", "LISTEN_NOW", "PLAY_GAME", "INSTALL_APP", "USE_APP", "NO_BUTTON"]);
const EVENT_ENUM = z.enum(["PURCHASE", "ADD_TO_CART", "INITIATE_CHECKOUT", "LEAD", "COMPLETE_REGISTRATION", "CONTACT", "VIEW_CONTENT", "ADD_PAYMENT_INFO", "ADD_TO_WISHLIST", "SEARCH", "START_TRIAL", "SUBSCRIBE", "SUBMIT_APPLICATION", "SCHEDULE", "DONATE", "FIND_LOCATION", "CUSTOMIZE_PRODUCT", "OTHER"]);
const BID_ENUM = z.enum(["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP", "LOWEST_COST_WITH_MIN_ROAS"]);
const PLACEMENTS_SCHEMA = z.object({
  publisher_platforms: z.array(z.string().max(30)).max(6),
  facebook_positions: z.array(z.string().max(40)).max(20).optional(),
  instagram_positions: z.array(z.string().max(40)).max(20).optional(),
  messenger_positions: z.array(z.string().max(40)).max(10).optional(),
  audience_network_positions: z.array(z.string().max(40)).max(10).optional(),
});
const AD_SCHEDULE_SCHEMA = z.array(z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), start_minute: z.number().int().min(0).max(1440), end_minute: z.number().int().min(0).max(1440) })).max(20);

// One ad inside an ad set (multi-ad campaigns).
const adInSchema = z.object({
  adName: z.string().min(1).max(200),
  existingPostId: z.string().max(80).optional(),
  message: z.string().max(5000).optional(),
  headline: z.string().max(255).optional(),
  link: z.string().max(1000).optional(),
  cta: CTA_ENUM.optional(),
  imageBase64: z.string().max(8_000_000).optional(),
  videoId: z.string().regex(/^\d+$/).optional(),
  videoPath: z.string().max(300).regex(/^[0-9a-f-]{36}\/[\w.-]+$/).optional(),
  messages: z.array(z.string().max(5000)).max(5).optional(),
  headlines: z.array(z.string().max(255)).max(5).optional(),
  description: z.string().max(255).optional(),
  displayLink: z.string().max(200).optional(),
  urlTags: z.string().max(1000).optional(),
  advantageCreative: z.boolean().default(false),
  format: z.enum(["single", "carousel", "catalog"]).default("single"),
  cards: z.array(z.object({ imageBase64: z.string().max(6_000_000), headline: z.string().max(255).optional(), description: z.string().max(255).optional(), link: z.string().max(1000).optional() })).max(10).optional(),
});

// One ad set with its own audience/budget/schedule and its ads.
const adsetInSchema = z.object({
  adsetName: z.string().min(1).max(200),
  conversionLocation: z.enum(["WEBSITE", "MESSAGING"]).default("WEBSITE"),
  pixelId: z.string().regex(/^\d+$/).optional(),
  customEvent: EVENT_ENUM.optional(),
  customConversionId: z.string().regex(/^\d+$/).optional(),
  performanceGoal: z.enum(["CONVERSIONS", "VALUE"]).default("CONVERSIONS"),
  attribution: z.enum(["7C1V", "7C", "1C", "1C1V"]).default("7C1V"),
  advantageSales: z.boolean().default(false),
  advantageAudience: z.boolean().default(false),
  customAudiences: z.array(z.string().regex(/^\d+$/)).max(50).default([]),
  excludedAudiences: z.array(z.string().regex(/^\d+$/)).max(50).default([]),
  locales: z.array(z.number().int()).max(50).default([]),
  placements: PLACEMENTS_SCHEMA.optional(),
  adSchedule: AD_SCHEDULE_SCHEMA.optional(),
  catalogId: z.string().regex(/^\d+$/).optional(),
  productSetId: z.string().regex(/^\d+$/).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  budgetType: z.enum(["daily", "lifetime"]),
  amount: z.number().min(1).max(100000),
  bidStrategy: BID_ENUM,
  bidAmount: z.number().positive().optional(),
  countries: z.array(z.string().length(2)).min(1).max(25),
  ageMin: z.number().int().min(18).max(65),
  ageMax: z.number().int().min(18).max(65),
  genders: z.array(z.union([z.literal(1), z.literal(2)])).max(2),
  interests: z.array(z.object({ id: z.string(), name: z.string(), type: z.string().max(40).optional() })).max(25),
  connections: z.enum(["all", "include", "exclude"]).default("all"),
  msgDestinations: z.array(z.enum(["MESSENGER", "WHATSAPP"])).max(2).optional(),
  whatsappNumber: z.string().max(30).optional(),
  phoneNumber: z.string().max(30).optional(),
  mainDestination: z.enum(["WEBSITE", "CALL", "BOTH"]).optional(),
  engagementLocation: z.enum(["ON_AD", "MESSAGING", "WEBSITE", "CALLS", "PAGE_LIKES", "EVENT"]).optional(),
  ads: z.array(adInSchema).min(1).max(10),
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), dateFrom: z.string().regex(dateRe), dateTo: z.string().regex(dateRe), asUserId: z.string().uuid().optional(), adAccountDbId: z.string().uuid().optional() }),
  z.object({ action: z.literal("accounts"), asUserId: z.string().uuid().optional() }),
  z.object({ action: z.literal("delete"), level: z.enum(["campaign", "adset", "ad"]), objectId: z.string().regex(/^\d+$/), asUserId: z.string().uuid().optional(), adAccountDbId: z.string().uuid().optional() }),
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
    description: z.string().max(255).optional(), cta: z.string().regex(/^[A-Z_]{3,30}$/).optional(),
    imageBase64: z.string().max(8_000_000).optional(),
    videoPath: z.string().max(300).regex(/^[0-9a-f-]{36}\/[\w.-]+$/).optional(),
    newPostId: z.string().regex(/^\d+(_\d+)?$/).optional(),
    postMessage: z.string().max(5000).optional(),
  }),
  z.object({ action: z.literal("set_budget"), objectId: z.string().regex(/^\d+$/), budgetType: z.enum(["daily", "lifetime"]), amount: z.number().positive().max(1000000), asUserId: z.string().uuid().optional(), adAccountDbId: z.string().uuid().optional() }),
  z.object({ action: z.literal("interests"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid().optional(), q: z.string().min(2).max(60) }),
  z.object({ action: z.literal("sales_assets"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid(), pixelId: z.string().regex(/^\d+$/).optional(), catalogId: z.string().regex(/^\d+$/).optional() }),
  z.object({ action: z.literal("pixels"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("page_info"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("fb_status") }),
  z.object({ action: z.literal("videos"), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("video_start"), adAccountDbId: z.string().uuid(), fileSize: z.number().int().positive().max(4_000_000_000) }),
  z.object({ action: z.literal("video_chunk"), adAccountDbId: z.string().uuid(), sessionId: z.string().regex(/^\d+$/), startOffset: z.number().int().min(0), chunkBase64: z.string().max(14_000_000) }),
  z.object({ action: z.literal("video_finish"), adAccountDbId: z.string().uuid(), sessionId: z.string().regex(/^\d+$/), title: z.string().max(200).optional() }),
  z.object({ action: z.literal("account_summary"), ids: z.array(z.string().uuid()).min(1).max(60), asUserId: z.string().uuid().optional() }),
  z.object({ action: z.literal("demographics"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid().optional(), q: z.string().max(60).optional() }),
  z.object({ action: z.literal("posts"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("request_page_access"), pageDbId: z.string().uuid(), adAccountDbId: z.string().uuid() }),
  z.object({ action: z.literal("link_page"), pageUrl: z.string().min(3).max(500), adAccountDbId: z.string().uuid() }),
  z.object({
    action: z.literal("create"),
    pageDbId: z.string().uuid(),
    adAccountDbId: z.string().uuid().optional(),
    objective: z.enum(["SALES", "LEADS", "MESSAGES", "TRAFFIC", "ENGAGEMENT", "AWARENESS"]),
    conversionLocation: z.enum(["WEBSITE", "MESSAGING"]).default("WEBSITE"),
    budgetLevel: z.enum(["campaign", "adset"]).default("adset"),
    startTime: z.string().optional(),
    cta: z.enum(["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "ORDER_NOW", "BUY_NOW", "CONTACT_US", "SEND_MESSAGE", "MESSAGE_PAGE", "GET_OFFER", "BOOK_TRAVEL", "SEE_MORE", "SUBSCRIBE", "DOWNLOAD", "APPLY_NOW", "GET_QUOTE", "BOOK_NOW", "SEE_MENU", "WATCH_MORE", "GET_STARTED", "INQUIRE_NOW", "REQUEST_TIME", "DONATE_NOW", "GET_SHOWTIMES", "LISTEN_NOW", "PLAY_GAME", "INSTALL_APP", "USE_APP", "NO_BUTTON"]).optional(),
    specialCategories: z.array(z.enum(["CREDIT", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES"])).max(5).default([]),
    pixelId: z.string().regex(/^\d+$/).optional(),
    customEvent: z.enum(["PURCHASE", "ADD_TO_CART", "INITIATE_CHECKOUT", "LEAD", "COMPLETE_REGISTRATION", "CONTACT", "VIEW_CONTENT", "ADD_PAYMENT_INFO", "ADD_TO_WISHLIST", "SEARCH", "START_TRIAL", "SUBSCRIBE", "SUBMIT_APPLICATION", "SCHEDULE", "DONATE", "FIND_LOCATION", "CUSTOMIZE_PRODUCT", "OTHER"]).optional(),
    customConversionId: z.string().regex(/^\d+$/).optional(),
    performanceGoal: z.enum(["CONVERSIONS", "VALUE"]).default("CONVERSIONS"),
    attribution: z.enum(["7C1V", "7C", "1C", "1C1V"]).default("7C1V"),
    advantageSales: z.boolean().default(false),
    advantageAudience: z.boolean().default(false),
    customAudiences: z.array(z.string().regex(/^\d+$/)).max(50).default([]),
    excludedAudiences: z.array(z.string().regex(/^\d+$/)).max(50).default([]),
    locales: z.array(z.number().int()).max(50).default([]),
    placements: z.object({
      publisher_platforms: z.array(z.string().max(30)).max(6),
      facebook_positions: z.array(z.string().max(40)).max(20).optional(),
      instagram_positions: z.array(z.string().max(40)).max(20).optional(),
      messenger_positions: z.array(z.string().max(40)).max(10).optional(),
      audience_network_positions: z.array(z.string().max(40)).max(10).optional(),
    }).optional(),
    adSchedule: z.array(z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), start_minute: z.number().int().min(0).max(1440), end_minute: z.number().int().min(0).max(1440) })).max(20).optional(),
    catalogId: z.string().regex(/^\d+$/).optional(),
    productSetId: z.string().regex(/^\d+$/).optional(),
    format: z.enum(["single", "carousel", "catalog"]).default("single"),
    cards: z.array(z.object({ imageBase64: z.string().max(6_000_000), headline: z.string().max(255).optional(), description: z.string().max(255).optional(), link: z.string().max(1000).optional() })).max(10).optional(),
    messages: z.array(z.string().max(5000)).max(5).optional(),
    headlines: z.array(z.string().max(255)).max(5).optional(),
    description: z.string().max(255).optional(),
    displayLink: z.string().max(200).optional(),
    urlTags: z.string().max(1000).optional(),
    advantageCreative: z.boolean().default(false),
    campaignName: z.string().min(1).max(200),
    adsetName: z.string().min(1).max(200),
    adName: z.string().min(1).max(200),
    budgetType: z.enum(["daily", "lifetime"]),
    amount: z.number().min(1).max(100000),
    endTime: z.string().optional(),
    bidStrategy: z.enum(["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP", "LOWEST_COST_WITH_MIN_ROAS"]),
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
    engagementLocation: z.enum(["ON_AD", "MESSAGING", "WEBSITE", "CALLS", "PAGE_LIKES", "EVENT"]).optional(),
    videoPath: z.string().max(300).regex(/^[0-9a-f-]{36}\/[\w.-]+$/).optional(),
    connections: z.enum(["all", "include", "exclude"]).default("all"),
    msgDestinations: z.array(z.enum(["MESSENGER", "WHATSAPP"])).max(2).optional(),
    whatsappNumber: z.string().max(30).optional(),
    phoneNumber: z.string().max(30).optional(),
    videoId: z.string().regex(/^\d+$/).optional(),
    mainDestination: z.enum(["WEBSITE", "CALL", "BOTH"]).optional(),
    publish: z.boolean(),
    // Multi ad set / multi ad create. When present, the top-level adset/ad fields are ignored.
    adsets: z.array(adsetInSchema).min(1).max(10).optional(),
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
function friendly(e: any): string {
  const m = String(e?.message || e || "");
  if (/\(#200\)|permission/i.test(m)) return `Permission নেই — Page/ad account-এ access দিন (${m})`;
  if (/\(#100\)|invalid/i.test(m)) return `Facebook এই তথ্য মানছে না, ঠিক করে আবার দিন (${m})`;
  if (/cannot be edited|in review|being reviewed/i.test(m)) return `এখন এই ad বদলানো যাবে না, review শেষ হলে চেষ্টা করুন (${m})`;
  if (/\(#1\)|unknown error/i.test(m)) return `Facebook সাময়িকভাবে কাজটি করতে পারেনি — ad account disabled/unsettled হলে এমন হয়। Account-এর status ঠিক আছে কি না দেখে কয়েক মিনিট পর আবার চেষ্টা করুন (${m})`;
  return m;
}

async function clientUserToken(supabaseAdmin: any, userId: string): Promise<string | undefined> {
  try {
    const { data } = await supabaseAdmin.from("client_user_tokens").select("access_token").eq("user_id", userId).maybeSingle();
    if (!data?.access_token) return undefined;
    const sec = process.env.BM_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const { decryptToken } = await import("@/lib/metaGraph.server");
    return await decryptToken(data.access_token, sec);
  } catch { return undefined; }
}

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

  // Ad account video library (videos live in the Meta ad account itself).
  if (body.action === "videos" || body.action === "video_start" || body.action === "video_chunk" || body.action === "video_finish") {
    const accId = body.adAccountDbId;
    const allowed = (await sharedAccountIds(supabaseAdmin, targetUser)).includes(accId)
      || (await ownAccounts(supabaseAdmin, targetUser, true, isAdmin)).some((a: any) => a.id === accId);
    if (!allowed) throw new Error("এই ad account আপনাকে দেওয়া হয়নি");
    const { token, act } = await tokenFor(supabaseAdmin, accId);
    const g = graphClient(token);
    if (body.action === "videos") {
      const r = await g.get(`${act}/advideos`, { fields: "id,title,picture,length,created_time,source", limit: "100" });
      const list = r.data ?? [];
      // Some videos come back without a playable link in the list; ask each one directly.
      await Promise.all(list.filter((v: any) => !v.source).map(async (v: any) => {
        const one = await g.get(String(v.id), { fields: "source,picture" }).catch(() => null);
        if (one?.source) v.source = one.source;
        if (!v.picture && one?.picture) v.picture = one.picture;
      }));
      return { videos: list.map((v: any) => ({ id: String(v.id), title: v.title || "Video", picture: v.picture ?? null, length: v.length ?? null, source: v.source ?? null, created: v.created_time ?? null })) };
    }
    if (body.action === "video_start") {
      const r = await g.post(`${act}/advideos`, { upload_phase: "start", file_size: body.fileSize });
      return { sessionId: String(r.upload_session_id), videoId: String(r.video_id), start: Number(r.start_offset), end: Number(r.end_offset) };
    }
    if (body.action === "video_chunk") {
      const bin = Uint8Array.from(atob(body.chunkBase64), (ch) => ch.charCodeAt(0));
      const fd = new FormData();
      fd.append("access_token", token); fd.append("upload_phase", "transfer");
      fd.append("upload_session_id", body.sessionId); fd.append("start_offset", String(body.startOffset));
      fd.append("video_file_chunk", new Blob([bin]), "chunk");
      const res = await fetch(`https://graph-video.facebook.com/v25.0/${act}/advideos`, { method: "POST", body: fd });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error?.error_user_msg || j.error?.message || "Video upload ব্যর্থ");
      return { start: Number(j.start_offset), end: Number(j.end_offset) };
    }
    await g.post(`${act}/advideos`, { upload_phase: "finish", upload_session_id: body.sessionId, ...(body.title ? { title: body.title } : {}) });
    return { ok: true };
  }

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
    const listP = loadOwned(supabaseAdmin, targetUser, { since: body.dateFrom, until: body.dateTo }, { includeOwn: true, viewAllOwn: true, allForAdmin: isAdmin && targetUser === user.id, onlyAccount: body.adAccountDbId ?? "first" });
    const walletP = walletBalance(supabaseAdmin, targetUser);
    listP.catch(() => null); walletP.catch(() => null);
    const { error: keyErr } = await supabaseAdmin.from("ad_accounts").select("id", { head: true, count: "exact" });
    if (keyErr) {
      const { describeKey } = await import("@/lib/serverKey");
      const k = describeKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
      const why = k.role === "anon" || k.role === "publishable" ? "এটা anon/public key, service_role key না"
        : k.role === "unknown" ? `key-এর ধরন চেনা যাচ্ছে না (${k.length} অক্ষর, শুরু "${k.startsWith}…") — পুরো key কপি হয়নি বা ভুল জিনিস বসানো হয়েছে`
        : k.projectRef && k.projectRef !== "dhswrfzdqcavgmymllat" ? "key-টা অন্য Supabase project-এর" : `সার্ভার বলছে: ${keyErr.message || keyErr.code || "অনুমতি নেই"}`;
      throw new Error(`সার্ভারের গোপন key (SUPABASE_SERVICE_ROLE_KEY) ঠিক নেই — ${why}। Vercel-এ সঠিক service_role key বসিয়ে Redeploy করুন`);
    }
    const [data, wb] = await Promise.all([listP, walletP]);
    return { ...data, ...settings, walletBalance: wb, fetchedAt: new Date().toISOString() };
  }

  if (body.action === "delete" || body.action === "set_status" || body.action === "set_budget" || body.action === "update") {
    const owned = await loadOwned(supabaseAdmin, targetUser, undefined, { includeOwn: true, viewAllOwn: true, allForAdmin: isAdmin && targetUser === user.id, onlyAccount: body.adAccountDbId });
    const lvl = body.action === "set_budget" ? "adset" : body.level;
    const list = lvl === "campaign" ? owned.campaigns : lvl === "adset" ? owned.adsets : owned.ads;
    const obj = list.find((o: any) => String(o.id) === body.objectId);
    if (!obj) throw new Error("এই campaign/ad আপনার নয়");
    if (body.action === "delete") {
      const { token } = await tokenFor(supabaseAdmin, obj.ad_account_db_id);
      const result = await graphClient(token).post(body.objectId, { status: "DELETED" });
      if (result?.success !== true) throw new Error("Facebook বিজ্ঞাপন মুছে দেওয়া নিশ্চিত করেনি — Refresh দিয়ে আবার দেখুন");
      return { ok: true };
    }
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
      let out: Record<string, unknown> = { ok: true };
      const creativeChange = body.message !== undefined || body.headline !== undefined || body.link !== undefined || body.description !== undefined
        || body.cta !== undefined || !!body.imageBase64 || !!body.videoPath || !!body.newPostId;
      if (lvl === "ad" && (creativeChange || body.postMessage !== undefined)) {
        if (body.videoPath && !body.videoPath.startsWith(`${user.id}/`) && !isAdmin) throw new Error("Video টি আপনার নয়");
        const act = `act_${String(owned.accounts.find((a: any) => a.id === obj.ad_account_db_id)?.account_id ?? "").replace(/^act_/, "")}`;
        const cur = await g.get(body.objectId, { fields: "creative{object_story_spec,object_story_id,effective_object_story_id,name,url_tags}" });
        const c: any = cur?.creative ?? {};
        const postId: string | undefined = c.object_story_id || c.effective_object_story_id;
        const pageId = String(c.object_story_spec?.page_id ?? postId?.split("_")[0] ?? "");
        if (body.postMessage !== undefined) {
          if (!postId) throw new Error("এই ad-এর সাথে কোনো page post নেই");
          const pt = await savedPageToken(supabaseAdmin, pageId, targetUser);
          if (!pt) throw new Error("Page-এর লেখা বদলাতে Facebook আবার connect করতে হবে (Page access দরকার)");
          await graphClient(pt).post(postId, { message: body.postMessage }).catch((e: any) => { throw new Error(`Post-এর লেখা বদলানো যায়নি: ${friendly(e)}`); });
          out.postUpdated = true;
        }
        if (creativeChange) {
          let creative: Record<string, unknown>;
          if (body.newPostId) {
            const sid = body.newPostId.includes("_") ? body.newPostId : `${pageId}_${body.newPostId}`;
            if (!sid.startsWith(`${pageId}_`)) throw new Error("Post টি এই page-এর নয়");
            creative = { name: `Edited Creative - ${Date.now()}`, object_story_id: sid };
          } else {
            const spec: any = c.object_story_spec;
            if (!spec?.link_data && !spec?.video_data) throw new Error("এই ad-টি page-এর post থেকে বানানো — অন্য post বেছে নিন বা post-এর লেখা বদলান");
            let ld: any = spec.link_data ? { ...spec.link_data } : null;
            let vd: any = spec.video_data ? { ...spec.video_data } : null;
            let imageHash: string | undefined;
            if (body.imageBase64) {
              const up = await g.post(`${act}/adimages`, { bytes: body.imageBase64 });
              imageHash = (Object.values(up.images ?? {})[0] as any)?.hash;
            }
            if (body.videoPath) {
              const { data: su } = await supabaseAdmin.storage.from("ad-media").createSignedUrl(body.videoPath, 3600);
              if (!su) throw new Error("Video পাওয়া যায়নি — আবার upload করুন");
              const vid = await g.post(`${act}/advideos`, { file_url: su.signedUrl, name: body.name ?? "edited video" });
              let thumb: string | undefined;
              for (let i = 0; i < 10 && !thumb; i++) {
                await new Promise((r) => setTimeout(r, 3000));
                const t = await g.get(`${vid.id}/thumbnails`, { fields: "uri,is_preferred" }).catch(() => null);
                thumb = (t?.data ?? []).find((x: any) => x.is_preferred)?.uri ?? t?.data?.[0]?.uri;
              }
              if (!thumb) throw new Error("Facebook এখনো video প্রসেস করছে — ১-২ মিনিট পর আবার চেষ্টা করুন");
              const src = ld ?? vd ?? {};
              vd = { video_id: String(vid.id), image_url: thumb, message: src.message, title: src.name ?? src.title, call_to_action: src.call_to_action, link_description: src.description ?? src.link_description };
              ld = null;
            } else if (imageHash) {
              const src = ld ?? vd ?? {};
              ld = { link: src.link ?? src.call_to_action?.value?.link ?? `https://facebook.com/${pageId}`, message: src.message, name: src.name ?? src.title, description: src.description ?? src.link_description, call_to_action: src.call_to_action, image_hash: imageHash };
              vd = null;
            }
            const d: any = ld ?? vd;
            if (ld) { delete ld.image_url; delete ld.picture; }
            if (body.message !== undefined) d.message = body.message;
            if (body.headline !== undefined) { if (ld) ld.name = body.headline; else vd.title = body.headline; }
            if (body.description !== undefined) { if (ld) ld.description = body.description; else vd.link_description = body.description; }
            if (body.link && /^https?:\/\//.test(body.link)) {
              if (ld) ld.link = body.link;
              if (d.call_to_action) d.call_to_action = { ...d.call_to_action, value: { ...(d.call_to_action.value ?? {}), link: body.link } };
            }
            if (body.cta && d.call_to_action) d.call_to_action = { ...d.call_to_action, type: body.cta };
            creative = { name: `Edited Creative - ${Date.now()}`, object_story_spec: { ...spec, link_data: ld ?? undefined, video_data: vd ?? undefined }, ...(c.url_tags ? { url_tags: c.url_tags } : {}) };
          }
          const cr = await g.post(`${act}/adcreatives`, creative).catch((e: any) => { throw new Error(friendly(e)); });
          upd.creative = { creative_id: String(cr.id) };
          out.creativeId = String(cr.id);
        }
      }
      if (!Object.keys(upd).length && out.postUpdated) return out;
      if (!Object.keys(upd).length) throw new Error("কিছু বদলানো হয়নি");
      await g.post(body.objectId, upd).catch((e: any) => { throw new Error(friendly(e)); });
      if (out.creativeId) {
        const pv = await g.get(`${body.objectId}/previews`, { ad_format: "DESKTOP_FEED_STANDARD" }).catch(() => null);
        const m = String(pv?.data?.[0]?.body ?? "").match(/src="([^"]+)"/);
        if (m) out.previewUrl = m[1].replace(/&amp;/g, "&");
      }
      return out;
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

  // Client pastes a Page link; CRM's BM sends a Page access request the Page admin approves on Facebook.
  if (body.action === "link_page") {
    const wantAcc = body.adAccountDbId;
    const allowed = (await sharedAccountIds(supabaseAdmin, targetUser)).includes(wantAcc)
      || (await ownAccounts(supabaseAdmin, targetUser, true, isAdmin)).some((a: any) => a.id === wantAcc);
    if (!allowed) throw new Error("এই ad account আপনাকে দেওয়া হয়নি");
    const { token, bmId } = await tokenFor(supabaseAdmin, wantAcc);
    if (!bmId) throw new Error("এই ad account-এর Business Manager CRM-এ পাওয়া যায়নি");
    const g = graphClient(token);
    const raw = body.pageUrl.trim();
    const { resolveFacebookPage } = await import("@/lib/facebookPageResolution.server");
    const userToken = await clientUserToken(supabaseAdmin, targetUser);
    const info = await resolveFacebookPage(raw, g, userToken ? graphClient(userToken) : undefined);
    const pageId = info.id;
    let already = false;
    let granted = false;
    // 1) Client is the Page admin and connected Facebook: grant our BM directly with their Page login (no approval needed).
    if (await savedPageToken(supabaseAdmin, pageId, targetUser)) {
      const problem = await ensurePageAccess(g, supabaseAdmin, pageId, targetUser, bmId);
      if (!problem) granted = true;
    }
    // 2) Otherwise send a BM request that the Page admin approves on Facebook.
    if (!granted) {
      try {
        await g.post(`${bmId}/client_pages`, { page_id: pageId, permitted_tasks: ["ADVERTISE", "ANALYZE", "CREATE_CONTENT"] });
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (/already/i.test(msg)) already = true;
        else {
          const hasLogin = !!(await savedPageToken(supabaseAdmin, pageId, targetUser));
          throw new Error(hasLogin
            ? `Facebook নিজে থেকে access দিতে ও request পাঠাতে দুটোই রাজি হয়নি: ${msg}। Page কোনো Business portfolio-র মালিকানায় থাকলে সেই Business-এর admin-কে Settings → Requests থেকে approve করতে হবে।`
            : `Facebook request পাঠাতে পারেনি: ${msg}। সহজ উপায়: ‘Facebook থেকে Page ও ID আনুন’ চেপে Page-এর admin Facebook দিয়ে login করুন ও এই Page-এ টিক দিন — তাহলে request ছাড়াই access নিজে থেকে যুক্ত হবে।`);
        }
      }
    }
    const { data: ex } = await supabaseAdmin.from("client_facebook_pages").select("id").eq("user_id", targetUser).eq("page_id", pageId).maybeSingle();
    if (!ex) await supabaseAdmin.from("client_facebook_pages").insert({ user_id: targetUser, page_id: pageId, page_name: info?.name || `Page ${pageId}`, page_url: info?.link || raw, ad_account_id: wantAcc } as any);
    const bm: any = await g.get(String(bmId), { fields: "name" }).catch(() => null);
    return { ok: true, already, pageId, pageName: info?.name ?? null, bmName: bm?.name ?? null, bmId: String(bmId) };
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
  const tf = await tokenFor(supabaseAdmin, wantAcc);
  const { act, bmId } = tf;
  let token = tf.token;
  // Own account: prefer the client's own Facebook login when it can use this ad account,
  // so their Page works even if our Business Manager has no access to it.
  let usingClientLogin = false;
  if (!shared) {
    const ut = await clientUserToken(supabaseAdmin, page.user_id);
    if (ut) {
      const ok: any = await graphClient(ut).get(act, { fields: "id" }).catch(() => null);
      if (ok?.id) { token = ut; usingClientLogin = true; }
    }
  }
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

  if (body.action === "sales_assets") {
    const safe = (p: Promise<any>) => p.catch(() => ({ data: [] }));
    const [cc, ca, sa, cats, ev, ps] = await Promise.all([
      safe(g.get(`${act}/customconversions`, { fields: "id,name,custom_event_type,pixel{id}", limit: "100" })),
      safe(g.get(`${act}/customaudiences`, { fields: "id,name,subtype,approximate_count_lower_bound", limit: "200" })),
      safe(g.get(`${act}/saved_audiences`, { fields: "id,name,targeting", limit: "100" })),
      bmId ? safe(g.get(`${bmId}/owned_product_catalogs`, { fields: "id,name,product_count", limit: "50" })).then(async (o: any) => {
        const c = await safe(g.get(`${bmId}/client_product_catalogs`, { fields: "id,name,product_count", limit: "50" }));
        return { data: [...(o.data ?? []), ...(c.data ?? [])] };
      }) : Promise.resolve({ data: [] }),
      body.pixelId ? safe(g.get(`${body.pixelId}/stats`, { aggregation: "event" })) : Promise.resolve({ data: [] }),
      body.catalogId ? safe(g.get(`${body.catalogId}/product_sets`, { fields: "id,name,product_count", limit: "100" })) : Promise.resolve({ data: [] }),
    ]);
    const events = new Set<string>();
    for (const row of ev.data ?? []) for (const d of row.data ?? [row]) if (d?.value) events.add(String(d.value));
    return {
      customConversions: (cc.data ?? []).map((x: any) => ({ id: String(x.id), name: x.name, event: x.custom_event_type, pixelId: x.pixel?.id ?? null })),
      customAudiences: (ca.data ?? []).map((x: any) => ({ id: String(x.id), name: x.name, subtype: x.subtype, size: x.approximate_count_lower_bound ?? null })),
      savedAudiences: (sa.data ?? []).map((x: any) => ({ id: String(x.id), name: x.name, targeting: x.targeting ?? null })),
      catalogs: [...new Map((cats.data ?? []).map((x: any) => [String(x.id), { id: String(x.id), name: x.name, count: x.product_count ?? null }])).values()],
      productSets: (ps.data ?? []).map((x: any) => ({ id: String(x.id), name: x.name, count: x.product_count ?? null })),
      pixelEvents: [...events],
    };
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
  const cbo = body.budgetLevel === "campaign" || body.advantageSales;

  // One campaign can hold many ad sets, each with many ads. Older callers send a single
  // ad set + ad at the top level; wrap those into the same shape so one path handles both.
  type AdIn = {
    adName: string; existingPostId?: string; message?: string; headline?: string; link?: string; cta?: string;
    imageBase64?: string; videoId?: string; videoPath?: string; messages?: string[]; headlines?: string[];
    description?: string; displayLink?: string; urlTags?: string; advantageCreative: boolean;
    format: "single" | "carousel" | "catalog";
    cards?: { imageBase64: string; headline?: string; description?: string; link?: string }[];
  };
  type AdsetIn = {
    adsetName: string; conversionLocation: "WEBSITE" | "MESSAGING"; pixelId?: string; customEvent?: string;
    customConversionId?: string; performanceGoal: "CONVERSIONS" | "VALUE"; attribution: "7C1V" | "7C" | "1C" | "1C1V";
    advantageSales: boolean; advantageAudience: boolean; customAudiences: string[]; excludedAudiences: string[];
    locales: number[]; placements?: { publisher_platforms: string[]; facebook_positions?: string[]; instagram_positions?: string[]; messenger_positions?: string[]; audience_network_positions?: string[] };
    adSchedule?: { days: number[]; start_minute: number; end_minute: number }[];
    catalogId?: string; productSetId?: string; startTime?: string; endTime?: string;
    budgetType: "daily" | "lifetime"; amount: number; bidStrategy: string; bidAmount?: number;
    countries: string[]; ageMin: number; ageMax: number; genders: (1 | 2)[];
    interests: { id: string; name: string; type?: string }[]; connections: "all" | "include" | "exclude";
    msgDestinations?: ("MESSENGER" | "WHATSAPP")[]; whatsappNumber?: string; phoneNumber?: string;
    mainDestination?: "WEBSITE" | "CALL" | "BOTH";
    engagementLocation?: "ON_AD" | "MESSAGING" | "WEBSITE" | "CALLS" | "PAGE_LIKES" | "EVENT";
    ads: AdIn[];
  };
  const adsetsIn: AdsetIn[] = body.adsets?.length ? body.adsets : [{
    adsetName: body.adsetName, conversionLocation: body.conversionLocation, pixelId: body.pixelId, customEvent: body.customEvent,
    customConversionId: body.customConversionId, performanceGoal: body.performanceGoal, attribution: body.attribution,
    advantageSales: body.advantageSales, advantageAudience: body.advantageAudience, customAudiences: body.customAudiences,
    excludedAudiences: body.excludedAudiences, locales: body.locales, placements: body.placements, adSchedule: body.adSchedule,
    catalogId: body.catalogId, productSetId: body.productSetId, startTime: body.startTime, endTime: body.endTime,
    budgetType: body.budgetType, amount: body.amount, bidStrategy: body.bidStrategy, bidAmount: body.bidAmount,
    countries: body.countries, ageMin: body.ageMin, ageMax: body.ageMax, genders: body.genders, interests: body.interests,
    connections: body.connections, msgDestinations: body.msgDestinations, whatsappNumber: body.whatsappNumber,
    phoneNumber: body.phoneNumber, mainDestination: body.mainDestination, engagementLocation: body.engagementLocation,
    ads: [{
      adName: body.adName, existingPostId: body.existingPostId, message: body.message, headline: body.headline,
      link: body.link, cta: body.cta, imageBase64: body.imageBase64, videoId: body.videoId, videoPath: body.videoPath,
      messages: body.messages, headlines: body.headlines, description: body.description, displayLink: body.displayLink,
      urlTags: body.urlTags, advantageCreative: body.advantageCreative, format: body.format, cards: body.cards,
    }],
  }];

  const totalBudget = cbo ? body.amount : adsetsIn.reduce((t, s) => t + s.amount, 0);
  if (shared && !isAdmin && totalBudget > bal) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — এর বেশি budget দেওয়া যাবে না`);
  if (shared && body.publish && bal <= settings.pauseThreshold) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — আগে top-up করুন`);
  if (cbo && body.budgetType === "lifetime" && !body.endTime) throw new Error("Lifetime budget-এর জন্য শেষ তারিখ দিন");
  for (const s of adsetsIn) {
    if (!cbo && s.budgetType === "lifetime" && !s.endTime) throw new Error(`"${s.adsetName}" — Lifetime budget-এর জন্য শেষ তারিখ দিন`);
    const bs = cbo ? body.bidStrategy : s.bidStrategy;
    const ba = cbo ? body.bidAmount : s.bidAmount;
    if (bs !== "LOWEST_COST_WITHOUT_CAP" && !ba) throw new Error(bs === "LOWEST_COST_WITH_MIN_ROAS" ? "ROAS goal দিন (যেমন 2.0)" : "Bid amount দিন");
    for (const ad of s.ads) {
      if (ad.format === "carousel" && (ad.cards?.length ?? 0) < 2) throw new Error("Carousel-এ কমপক্ষে ২টা card দিন");
      if (ad.format === "catalog" && (!s.catalogId || !s.productSetId)) throw new Error("Catalog ও Product set বাছুন");
      if (ad.existingPostId && !ad.existingPostId.startsWith(`${page.page_id}_`) && !/^\d+$/.test(ad.existingPostId)) {
        throw new Error("Post টি এই page-এর নয়");
      }
      if (ad.videoPath && !ad.videoPath.startsWith(`${user.id}/`) && !isAdmin) throw new Error("Video টি আপনার নয়");
    }
  }

  const status = body.publish ? "ACTIVE" : "PAUSED";
  const base = {
    SALES: { objective: "OUTCOME_SALES", goal: "OFFSITE_CONVERSIONS", destination: "WEBSITE", cta: "SHOP_NOW" },
    LEADS: { objective: "OUTCOME_LEADS", goal: "OFFSITE_CONVERSIONS", destination: "WEBSITE", cta: "SIGN_UP" },
    MESSAGES: { objective: "OUTCOME_ENGAGEMENT", goal: "CONVERSATIONS", destination: "MESSENGER", cta: "MESSAGE_PAGE" },
    TRAFFIC: { objective: "OUTCOME_TRAFFIC", goal: "LINK_CLICKS", destination: "WEBSITE", cta: "LEARN_MORE" },
    ENGAGEMENT: { objective: "OUTCOME_ENGAGEMENT", goal: "POST_ENGAGEMENT", destination: "ON_POST", cta: "" },
    AWARENESS: { objective: "OUTCOME_AWARENESS", goal: "REACH", destination: "", cta: "LEARN_MORE" },
  }[body.objective];
  const ATTR: Record<string, { event_type: string; window_days: number }[]> = {
    "7C1V": [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }],
    "7C": [{ event_type: "CLICK_THROUGH", window_days: 7 }],
    "1C": [{ event_type: "CLICK_THROUGH", window_days: 1 }],
    "1C1V": [{ event_type: "CLICK_THROUGH", window_days: 1 }, { event_type: "VIEW_THROUGH", window_days: 1 }],
  };
  const centsOf = (n: number) => String(Math.round(n * 100));
  const budgetKeyOf = (t: "daily" | "lifetime") => (t === "daily" ? "daily_budget" : "lifetime_budget");
  const bidFieldsOf = (strategy: string, amt?: number) =>
    !amt || strategy === "LOWEST_COST_WITHOUT_CAP" ? {}
      : strategy === "LOWEST_COST_WITH_MIN_ROAS" ? { bid_constraints: { roas_average_floor: Math.round(amt * 10000) } }
      : { bid_amount: String(Math.round(amt * 100)) };

  // Before creating anything: the ad account must be active and our Business must be able to use the Page.
  const accInfo = await g.get(act, { fields: "account_status,name" }).catch(() => null);
  if (accInfo && Number(accInfo.account_status) !== 1) {
    const why: Record<number, string> = { 2: "Disabled", 3: "বিল বাকি (Unsettled)", 7: "Review চলছে", 9: "Grace period", 100: "বন্ধের প্রক্রিয়ায়", 101: "Closed" };
    throw new Error(`এই ad account (${accInfo.name}) Facebook-এ চালু নেই — অবস্থা: ${why[Number(accInfo.account_status)] ?? accInfo.account_status}। অন্য একটি চালু ad account বেছে নিন বা Admin-কে জানান`);
  }
  const accessProblem = usingClientLogin ? null : await ensurePageAccess(g, supabaseAdmin, pageId, page.user_id, bmId);

  let campaignId: string | null = null;
  let step = "Campaign";
  try {
    step = "Campaign";
    const catalogSrc = adsetsIn.find((s) => s.catalogId);
    const camp = await g.post(`${act}/campaigns`, {
      name: body.campaignName, objective: base.objective, status, buying_type: "AUCTION",
      special_ad_categories: body.specialCategories,
      ...(catalogSrc ? { promoted_object: { product_catalog_id: catalogSrc.catalogId } } : {}),
      ...(cbo ? { [budgetKeyOf(body.budgetType)]: centsOf(body.amount), bid_strategy: body.bidStrategy } : { is_adset_budget_sharing_enabled: false }),
    });
    campaignId = String(camp.id);
    if (shared) {
      await supabaseAdmin.from("managed_campaigns").insert({
        user_id: page.user_id, page_id: pageId, ad_account_id: wantAcc, campaign_id: campaignId, campaign_name: body.campaignName,
      });
    }

    for (const s of adsetsIn) {
      step = `Ad set "${s.adsetName}"`;
      // Goal/destination depend on this ad set's conversion location.
      const msging = (body.objective === "SALES" || body.objective === "LEADS") && s.conversionLocation === "MESSAGING";
      const eng = body.objective === "ENGAGEMENT" ? (s.engagementLocation ?? "ON_AD") : null;
      const dests = s.msgDestinations?.length ? s.msgDestinations : ["MESSENGER"];
      const msgDest = dests.length === 2 ? "MESSAGING_MESSENGER_WHATSAPP" : dests[0];
      let map: { objective: string; goal: string; destination: string; cta: string } = msging ? { ...base, goal: "CONVERSATIONS", destination: "MESSENGER", cta: "MESSAGE_PAGE" } : base;
      if (eng === "MESSAGING") map = { ...base, goal: "CONVERSATIONS", destination: msgDest, cta: "MESSAGE_PAGE" };
      if (eng === "WEBSITE") map = { ...base, goal: "LINK_CLICKS", destination: "WEBSITE", cta: "LEARN_MORE" };
      const callAd = eng === "CALLS" || (!eng && !msging && s.mainDestination === "CALL" && ["SALES", "LEADS", "TRAFFIC"].includes(body.objective));
      const bothAd = !eng && !msging && s.mainDestination === "BOTH" && ["SALES", "LEADS"].includes(body.objective);
      if (bothAd) map = { ...base, destination: "WEBSITE_AND_PHONE_CALL" };
      if (callAd) map = { ...base, goal: "QUALITY_CALL", destination: "PHONE_CALL", cta: "CALL_NOW" };
      if (eng === "PAGE_LIKES") map = { ...base, goal: "PAGE_LIKES", destination: "ON_PAGE", cta: "LIKE_PAGE" };
      if (eng === "EVENT") map = { ...base, goal: "EVENT_RESPONSES", destination: "ON_EVENT", cta: "" };
      if (eng === "EVENT" && !s.ads.some((a) => a.existingPostId)) throw new Error("Event response-এর জন্য page-এর event post বাছুন");
      const isMsg = ["MESSENGER", "WHATSAPP", "MESSAGING_MESSENGER_WHATSAPP"].includes(map.destination);
      const waOnly = map.destination === "WHATSAPP";
      if ((callAd || bothAd) && !s.phoneNumber) throw new Error("Call-এর জন্য phone number দিন");
      const pixelNeeded = (body.objective === "SALES" || body.objective === "LEADS") && !msging && !callAd;
      if (eng === "ON_AD" && !s.ads.some((a) => a.existingPostId)) throw new Error("Engagement-এর জন্য page-এর একটি post বাছুন");
      if (pixelNeeded && (!s.pixelId || (!s.customEvent && !s.customConversionId))) throw new Error("Website conversion-এর জন্য Dataset (Pixel) ও conversion event বাছুন");

      const targeting: Record<string, unknown> = {
        geo_locations: { countries: s.countries, location_types: ["home", "recent"] },
        age_min: Math.min(s.ageMin, s.ageMax), age_max: Math.max(s.ageMin, s.ageMax),
        targeting_automation: { advantage_audience: s.advantageAudience || s.advantageSales ? 1 : 0 },
      };
      if (s.connections === "include") targeting.connections = [{ id: pageId }];
      if (s.connections === "exclude") targeting.excluded_connections = [{ id: pageId }];
      if (s.customAudiences.length) targeting.custom_audiences = s.customAudiences.map((id) => ({ id }));
      if (s.excludedAudiences.length) targeting.excluded_custom_audiences = s.excludedAudiences.map((id) => ({ id }));
      if (s.locales.length) targeting.locales = s.locales;
      if (s.placements && !s.advantageSales && s.placements.publisher_platforms.length) {
        Object.assign(targeting, s.placements);
      }
      if (s.genders.length === 1) targeting.genders = s.genders;
      if (s.interests.length && !s.advantageSales) {
        const grp: Record<string, { id: string; name: string }[]> = {};
        for (const i of s.interests) { const k = i.type || "interests"; (grp[k] ??= []).push({ id: i.id, name: i.name }); }
        targeting.flexible_spec = [grp];
      }

      const adset = await g.post(`${act}/adsets`, {
        name: s.adsetName, campaign_id: campaignId, status,
        billing_event: "IMPRESSIONS", optimization_goal: pixelNeeded && s.performanceGoal === "VALUE" ? "VALUE" : map.goal,
        ...(pixelNeeded ? { attribution_spec: ATTR[s.attribution] } : {}),
        ...(s.adSchedule?.length && s.budgetType === "lifetime" ? { pacing_type: ["day_parting"], adset_schedule: s.adSchedule.map((x) => ({ ...x, timezone_type: "USER" })) } : {}),
        ...(map.destination ? { destination_type: map.destination } : {}),
        ...(cbo ? {} : { bid_strategy: s.bidStrategy, [budgetKeyOf(s.budgetType)]: centsOf(s.amount) }),
        ...bidFieldsOf(cbo ? body.bidStrategy : s.bidStrategy, cbo ? body.bidAmount : s.bidAmount),
        ...(s.startTime ? { start_time: s.startTime } : {}),
        ...(s.endTime ? { end_time: s.endTime } : {}),
        promoted_object: pixelNeeded ? {
            pixel_id: s.pixelId,
            ...(s.customConversionId ? { custom_conversion_id: s.customConversionId, custom_event_type: "OTHER" } : { custom_event_type: s.customEvent }),
            ...(s.catalogId && s.productSetId ? { product_set_id: s.productSetId } : {}),
          }
          : map.destination.includes("WHATSAPP") ? (s.whatsappNumber && /\d{8}/.test(s.whatsappNumber.replace(/\D/g, "")) ? { page_id: pageId, whatsapp_phone_number: s.whatsappNumber.replace(/[^\d]/g, "") } : { page_id: pageId }) : { page_id: pageId },
        targeting,
      });

      for (const ad of s.ads) {
        step = `Ad "${ad.adName}"`;
        if (eng === "WEBSITE" && !ad.existingPostId && !/^https?:\/\//.test(ad.link || "")) throw new Error("Website URL দিন (https://...)");
        if ((pixelNeeded || (body.objective === "TRAFFIC" && !callAd)) && !ad.existingPostId && !/^https?:\/\//.test(ad.link || "")) throw new Error("Website URL দিন (https://...)");

        let creative: Record<string, unknown>;
        // A plain existing post has no Message/Call button, so Meta rejects it for message/call/website ads
        // (#1487891). For those, rebuild the ad from the post's own text + photo with the right button.
        // Also rebuild when the client picked a button (e.g. Order Now) for an existing post.
        const rebuildFromPost = !!ad.existingPostId && (isMsg || callAd || bothAd || eng === "WEBSITE" || (!!ad.cta && body.objective !== "AWARENESS" && eng !== "ON_AD" && eng !== "EVENT"));
        let postText: string | undefined; let postImageB64: string | undefined;
        if (rebuildFromPost) {
          const storyId = ad.existingPostId!.includes("_") ? ad.existingPostId! : `${pageId}_${ad.existingPostId}`;
          let pt = await savedPageToken(supabaseAdmin, pageId, page.user_id);
          if (!pt) { try { pt = (await g.get(pageId, { fields: "access_token" })).access_token; } catch { /* none */ } }
          const post: any = await (pt ? graphClient(pt) : g).get(storyId, { fields: "message,full_picture" }).catch(() => null);
          if (!post) throw new Error("Post টি পড়া যায়নি — Facebook আবার connect করে চেষ্টা করুন বা নতুন ছবি দিয়ে ad বানান");
          postText = post.message ?? "";
          if (post.full_picture) {
            const res = await fetch(post.full_picture);
            if (res.ok) {
              const buf = new Uint8Array(await res.arrayBuffer());
              let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
              postImageB64 = btoa(bin);
            }
          }
        }
        if (ad.existingPostId && !rebuildFromPost) {
          const storyId = ad.existingPostId.includes("_") ? ad.existingPostId : `${pageId}_${ad.existingPostId}`;
          creative = { name: `${ad.adName} creative`, object_story_id: storyId };
        } else {
          let imageHash: string | undefined;
          const imgB64 = ad.imageBase64 || postImageB64;
          if (imgB64) {
            const up = await g.post(`${act}/adimages`, { bytes: imgB64 });
            imageHash = (Object.values(up.images ?? {})[0] as any)?.hash;
          }
          // Message ads need Meta's special links, otherwise Meta says "Invalid creative for objective" (#1487891).
          const link = waOnly ? "https://api.whatsapp.com/send"
            : isMsg ? "https://fb.com/messenger_doc/"
            : ad.link && /^https?:\/\//.test(ad.link) ? ad.link : `https://facebook.com/${pageId}`;
          const ctaType = waOnly ? "WHATSAPP_MESSAGE" : isMsg ? "MESSAGE_PAGE" : callAd ? "CALL_NOW" : eng === "PAGE_LIKES" ? "LIKE_PAGE" : (ad.cta || map.cta || "LEARN_MORE");
          const cta: Record<string, unknown> = {
            type: ctaType,
            value: waOnly ? { app_destination: "WHATSAPP" } : isMsg ? { app_destination: "MESSENGER" } : callAd ? { link: `tel:${s.phoneNumber}` } : eng === "PAGE_LIKES" ? { page: pageId } : { link },
          };
          const msgs = (ad.messages ?? []).map((x) => x.trim()).filter(Boolean);
          const heads = (ad.headlines ?? []).map((x) => x.trim()).filter(Boolean);
          const primary = msgs[0] || ad.message || postText || "";
          const head = heads[0] || ad.headline || undefined;
          const ld: Record<string, unknown> = { link, message: primary, name: head, image_hash: imageHash, call_to_action: cta };
          if (ad.description) ld.description = ad.description;
          if (ad.displayLink) ld.caption = ad.displayLink;
          if (ad.format === "carousel" && ad.cards?.length) {
            const kids = [];
            for (const c of ad.cards) {
              const up = await g.post(`${act}/adimages`, { bytes: c.imageBase64 });
              const h = (Object.values(up.images ?? {})[0] as any)?.hash;
              const cl = c.link && /^https?:\/\//.test(c.link) ? c.link : link;
              kids.push({ link: cl, image_hash: h, name: c.headline || head, description: c.description || undefined, call_to_action: { type: ctaType, value: { link: cl } } });
            }
            delete ld.image_hash; delete ld.name;
            ld.child_attachments = kids; ld.multi_share_optimized = true; ld.multi_share_end_card = false;
          }
          if (ad.format === "catalog") {
            delete ld.image_hash;
            ld.name = head || "{{product.name}}"; ld.description = ad.description || "{{product.price}}";
            creative = { name: `${ad.adName} creative`, product_set_id: s.productSetId, object_story_spec: { page_id: pageId, template_data: ld } };
          } else {
            creative = { name: `${ad.adName} creative`, object_story_spec: { page_id: pageId, link_data: ld } };
            if (ad.format === "single" && (msgs.length > 1 || heads.length > 1)) {
              creative.asset_feed_spec = {
                bodies: (msgs.length ? msgs : [primary]).map((text) => ({ text })),
                titles: (heads.length ? heads : head ? [head] : []).map((text) => ({ text })),
                ...(ad.description ? { descriptions: [{ text: ad.description }] } : {}),
                optimization_type: "DEGREES_OF_FREEDOM",
              };
            }
          }
          if (ad.advantageCreative) creative.degrees_of_freedom_spec = { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" } } };
          if ((ad.videoId || ad.videoPath) && ad.format !== "carousel" && ad.format !== "catalog") {
            let vid: any;
            if (ad.videoId) vid = { id: ad.videoId };
            else {
              const { data: su, error: se } = await supabaseAdmin.storage.from("ad-media").createSignedUrl(ad.videoPath!, 3600);
              if (se || !su) throw new Error("Video পাওয়া যায়নি — আবার upload করুন");
              step = "Video upload";
              vid = await g.post(`${act}/advideos`, { file_url: su.signedUrl, name: ad.adName });
            }
            let thumb: string | undefined;
            for (let i = 0; i < 10 && !thumb; i++) {
              await new Promise((r) => setTimeout(r, 3000));
              const t = await g.get(`${vid.id}/thumbnails`, { fields: "uri,is_preferred" }).catch(() => null);
              thumb = (t?.data ?? []).find((x: any) => x.is_preferred)?.uri ?? t?.data?.[0]?.uri;
            }
            if (!thumb) throw new Error("Facebook এখনো video প্রসেস করছে — ১-২ মিনিট পর আবার চেষ্টা করুন");
            const vd: Record<string, unknown> = { video_id: String(vid.id), image_url: thumb, message: ld.message, title: ld.name, call_to_action: ld.call_to_action };
            if (ad.description) vd.link_description = ad.description;
            creative.object_story_spec = { page_id: pageId, video_data: vd };
            delete creative.asset_feed_spec;
          }
          if (ad.urlTags) creative.url_tags = ad.urlTags.replace(/^\?/, "");
        }
        step = `Ad "${ad.adName}" creative`;
        let cr: any;
        try { cr = await g.post(`${act}/adcreatives`, creative); }
        catch (err: any) {
          // Page not yet shared with our ad token: grant access using the client's saved Page login, then retry once.
          if (!/1487202|page permission|full control|ADVERTISE|\(#100\)|\(#200\)/i.test(String(err?.message))) throw err;
          const p2 = usingClientLogin ? null : accessProblem ?? (await ensurePageAccess(g, supabaseAdmin, pageId, page.user_id, bmId));
          if (p2) throw new Error(p2);
          cr = await g.post(`${act}/adcreatives`, creative);
        }
        step = `Ad "${ad.adName}"`;
        await g.post(`${act}/ads`, { name: ad.adName, adset_id: adset.id, creative: { creative_id: cr.id }, status });
      }
    }
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
