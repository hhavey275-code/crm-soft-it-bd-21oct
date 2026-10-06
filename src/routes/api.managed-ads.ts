import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { tokenFor, loadOwned, walletBalance } from "@/lib/managedAds.server";

/**
 * Managed (shared ad account) Ads Manager API.
 * Clients only ever see/touch campaigns that belong to their approved Facebook pages.
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), dateFrom: z.string().regex(dateRe), dateTo: z.string().regex(dateRe), asUserId: z.string().uuid().optional() }),
  z.object({ action: z.literal("set_status"), level: z.enum(["campaign", "adset", "ad"]), objectId: z.string().regex(/^\d+$/), status: z.enum(["ACTIVE", "PAUSED"]), asUserId: z.string().uuid().optional() }),
  z.object({ action: z.literal("set_budget"), objectId: z.string().regex(/^\d+$/), budgetType: z.enum(["daily", "lifetime"]), amount: z.number().positive().max(100000), asUserId: z.string().uuid().optional() }),
  z.object({ action: z.literal("interests"), pageDbId: z.string().uuid(), q: z.string().min(2).max(60) }),
  z.object({
    action: z.literal("create"),
    pageDbId: z.string().uuid(),
    objective: z.enum(["MESSAGES", "TRAFFIC", "ENGAGEMENT", "AWARENESS"]),
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
    interests: z.array(z.object({ id: z.string(), name: z.string() })).max(25),
    existingPostId: z.string().max(80).optional(),
    message: z.string().max(5000).optional(),
    headline: z.string().max(255).optional(),
    link: z.string().max(1000).optional(),
    imageBase64: z.string().max(8_000_000).optional(),
    publish: z.boolean(),
  }),
]);

type Body = z.infer<typeof schema>;

async function ctx(request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(auth.slice(7).trim());
  if (!user) return null;
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", user.id);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "superadmin");
  return { supabaseAdmin, user, isAdmin };
}

async function handle(body: Body, c: NonNullable<Awaited<ReturnType<typeof ctx>>>) {
  const { supabaseAdmin, user, isAdmin } = c;
  const targetUser = "asUserId" in body && body.asUserId && isAdmin ? body.asUserId : user.id;
  const { graphClient } = await import("@/lib/metaGraph.server");

  if (body.action === "list") {
    const data = await loadOwned(supabaseAdmin, targetUser, { since: body.dateFrom, until: body.dateTo });
    return { ...data, walletBalance: await walletBalance(supabaseAdmin, targetUser), fetchedAt: new Date().toISOString() };
  }

  if (body.action === "set_status" || body.action === "set_budget") {
    const owned = await loadOwned(supabaseAdmin, targetUser);
    const list = body.action === "set_budget" ? owned.adsets : body.level === "campaign" ? owned.campaigns : body.level === "adset" ? owned.adsets : owned.ads;
    const obj = list.find((o: any) => String(o.id) === body.objectId);
    if (!obj) throw new Error("এই campaign/ad আপনার নয়");
    if (body.action === "set_budget") {
      const bal = await walletBalance(supabaseAdmin, targetUser);
      if (!isAdmin && body.amount > bal) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — এর বেশি budget দেওয়া যাবে না`);
    }
    const { token } = await tokenFor(supabaseAdmin, obj.ad_account_db_id);
    const g = graphClient(token);
    if (body.action === "set_status") await g.post(body.objectId, { status: body.status });
    else await g.post(body.objectId, { [body.budgetType === "daily" ? "daily_budget" : "lifetime_budget"]: String(Math.round(body.amount * 100)) });
    return { ok: true };
  }

  // interests + create need an approved page owned by the caller
  const { data: page } = await supabaseAdmin.from("client_facebook_pages").select("*").eq("id", body.pageDbId).maybeSingle();
  if (!page || page.status !== "approved" || !page.ad_account_id || (page.user_id !== user.id && !isAdmin)) {
    throw new Error("এই page অনুমোদিত নয়");
  }
  const { token, act } = await tokenFor(supabaseAdmin, page.ad_account_id);
  const g = graphClient(token);

  if (body.action === "interests") {
    const r = await g.get("search", { type: "adinterest", q: body.q, limit: "20" });
    return { interests: (r.data ?? []).map((i: any) => ({ id: String(i.id), name: i.name, audience: i.audience_size_upper_bound })) };
  }

  // ---- create ----
  const bal = await walletBalance(supabaseAdmin, page.user_id);
  if (!isAdmin && body.amount > bal) throw new Error(`Wallet-এ $${bal.toFixed(2)} আছে — এর বেশি budget দেওয়া যাবে না`);
  if (body.budgetType === "lifetime" && !body.endTime) throw new Error("Lifetime budget-এর জন্য শেষ তারিখ দিন");
  if (body.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && !body.bidAmount) throw new Error("Bid amount দিন");
  if (body.existingPostId && !body.existingPostId.startsWith(`${page.page_id}_`) && !/^\d+$/.test(body.existingPostId)) {
    throw new Error("Post টি এই page-এর নয়");
  }

  const pageId = String(page.page_id);
  const status = body.publish ? "ACTIVE" : "PAUSED";
  const map = {
    MESSAGES: { objective: "OUTCOME_ENGAGEMENT", goal: "CONVERSATIONS", destination: "MESSENGER", cta: "MESSAGE_PAGE" },
    TRAFFIC: { objective: "OUTCOME_TRAFFIC", goal: "LINK_CLICKS", destination: "WEBSITE", cta: "LEARN_MORE" },
    ENGAGEMENT: { objective: "OUTCOME_ENGAGEMENT", goal: "POST_ENGAGEMENT", destination: "ON_POST", cta: "" },
    AWARENESS: { objective: "OUTCOME_AWARENESS", goal: "REACH", destination: "", cta: "LEARN_MORE" },
  }[body.objective];
  if (body.objective === "ENGAGEMENT" && !body.existingPostId) throw new Error("Engagement-এর জন্য page-এর একটি post বাছুন");
  if (body.objective === "TRAFFIC" && !body.existingPostId && !/^https?:\/\//.test(body.link || "")) throw new Error("Website link দিন");

  let campaignId: string | null = null;
  try {
    const camp = await g.post(`${act}/campaigns`, {
      name: body.campaignName, objective: map.objective, status, special_ad_categories: [], is_adset_budget_sharing_enabled: false,
    });
    campaignId = String(camp.id);
    await supabaseAdmin.from("managed_campaigns").insert({
      user_id: page.user_id, page_id: pageId, ad_account_id: page.ad_account_id, campaign_id: campaignId, campaign_name: body.campaignName,
    });

    const targeting: Record<string, unknown> = {
      geo_locations: { countries: body.countries },
      age_min: Math.min(body.ageMin, body.ageMax), age_max: Math.max(body.ageMin, body.ageMax),
      targeting_automation: { advantage_audience: 0 },
    };
    if (body.genders.length === 1) targeting.genders = body.genders;
    if (body.interests.length) targeting.flexible_spec = [{ interests: body.interests }];

    const cents = String(Math.round(body.amount * 100));
    const adset = await g.post(`${act}/adsets`, {
      name: body.adsetName, campaign_id: campaignId, status,
      billing_event: "IMPRESSIONS", optimization_goal: map.goal,
      ...(map.destination ? { destination_type: map.destination } : {}),
      bid_strategy: body.bidStrategy,
      ...(body.bidAmount ? { bid_amount: String(Math.round(body.bidAmount * 100)) } : {}),
      [body.budgetType === "daily" ? "daily_budget" : "lifetime_budget"]: cents,
      ...(body.endTime ? { end_time: body.endTime } : {}),
      promoted_object: { page_id: pageId },
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
      const link = body.link && /^https?:\/\//.test(body.link) ? body.link : `https://facebook.com/${pageId}`;
      const cta: Record<string, unknown> = { type: map.cta || "LEARN_MORE", value: body.objective === "MESSAGES" ? { app_destination: "MESSENGER" } : { link } };
      creative = {
        name: `${body.adName} creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: { link, message: body.message || "", name: body.headline || undefined, image_hash: imageHash, call_to_action: cta },
        },
      };
    }
    const cr = await g.post(`${act}/adcreatives`, creative);
    await g.post(`${act}/ads`, { name: body.adName, adset_id: adset.id, creative: { creative_id: cr.id }, status });
    return { ok: true, campaignId };
  } catch (e) {
    if (campaignId) {
      await g.del(campaignId);
      await supabaseAdmin.from("managed_campaigns").delete().eq("campaign_id", campaignId);
    }
    throw e;
  }
}

export const Route = createFileRoute("/api/managed-ads")({
  server: {
    handlers: {
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
