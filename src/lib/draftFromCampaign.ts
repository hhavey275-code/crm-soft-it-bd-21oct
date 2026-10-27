// Browser-safe: turns a campaign already loaded in My Ads (campaign + its ad sets + ads) into a
// Create-wizard draft. Duplicate uses this, so copying is instant (no Facebook call) and the copy
// opens in the full Create wizard with every option editable before it is published.

type Page = { id: string; page_id: string };

const OBJ: Record<string, string> = {
  OUTCOME_SALES: "SALES", CONVERSIONS: "SALES", PRODUCT_CATALOG_SALES: "SALES",
  OUTCOME_LEADS: "LEADS", LEAD_GENERATION: "LEADS",
  OUTCOME_ENGAGEMENT: "ENGAGEMENT", MESSAGES: "ENGAGEMENT", POST_ENGAGEMENT: "ENGAGEMENT", PAGE_LIKES: "ENGAGEMENT", VIDEO_VIEWS: "ENGAGEMENT",
  OUTCOME_TRAFFIC: "TRAFFIC", LINK_CLICKS: "TRAFFIC",
  OUTCOME_AWARENESS: "AWARENESS", REACH: "AWARENESS", BRAND_AWARENESS: "AWARENESS",
};
const EVENT: Record<string, string> = {
  PURCHASE: "PURCHASE", ADD_TO_CART: "ADD_TO_CART", INITIATED_CHECKOUT: "INITIATE_CHECKOUT", LEAD: "LEAD",
  COMPLETE_REGISTRATION: "COMPLETE_REGISTRATION", CONTACT: "CONTACT", CONTENT_VIEW: "VIEW_CONTENT", ADD_PAYMENT_INFO: "ADD_PAYMENT_INFO",
  ADD_TO_WISHLIST: "ADD_TO_WISHLIST", SEARCH: "SEARCH", START_TRIAL: "START_TRIAL", SUBSCRIBE: "SUBSCRIBE",
};

const money = (cents: any) => (Number(cents) > 0 ? (Number(cents) / 100).toFixed(2) : "");
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const toLocal = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t) || t < Date.now()) return localNow(); // a copy never starts in the past
  return new Date(t - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function geo(t: any): string[] {
  const g = t?.geo_locations ?? {};
  const out: string[] = [...(g.countries ?? [])];
  for (const r of g.regions ?? []) out.push(`r:${r.key}:${String(r.name ?? "").slice(0, 80)}`);
  for (const c of g.cities ?? []) out.push(`c:${c.key}:${String(c.name ?? "").slice(0, 80)}`);
  return out.length ? out : ["BD"];
}

function interestsOf(t: any) {
  const out: { id: string; name: string; type?: string }[] = [];
  for (const grp of t?.flexible_spec ?? []) {
    for (const [type, list] of Object.entries(grp ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const i of list as any[]) if (i?.id) out.push({ id: String(i.id), name: String(i.name ?? i.id), type });
    }
  }
  return out;
}

function adFrom(a: any, objective: string) {
  const spec = a.creative?.object_story_spec ?? {};
  const v = spec.video_data, l = spec.link_data;
  const cta = v?.call_to_action ?? l?.call_to_action;
  const postId = String(a.creative?.effective_object_story_id ?? a.creative?.object_story_id ?? "");
  const base = { adName: `${a.name ?? "Ad"}`, postId: "", message: "", headline: "", link: "", cta: cta?.type ?? (objective === "SALES" ? "SHOP_NOW" : objective === "LEADS" ? "SIGN_UP" : "LEARN_MORE"), postCta: "", image: null, video: null as any };
  if (v?.video_id) {
    return { ...base, setup: "new", message: v.message ?? a.creative?.body ?? "", headline: v.title ?? a.creative?.title ?? "", link: cta?.value?.link ?? "",
      video: { id: String(v.video_id), name: v.title || a.name || "Video", picture: v.image_url ?? a.creative?.thumbnail_url ?? null, src: null } };
  }
  // Image/link ads and page-post ads: reuse the same post, like Facebook's "use existing post" (the
  // image cannot be carried into the draft). The client can switch to a new creative in the wizard.
  if (postId) return { ...base, setup: "post", postId, postCta: cta?.type ?? "" };
  return { ...base, setup: "new", message: l?.message ?? a.creative?.body ?? "", headline: l?.name ?? a.creative?.title ?? "", link: l?.link ?? "" };
}

export function draftFromCampaign(c: any, allAdsets: any[], allAds: any[], pages: Page[]) {
  const objective = OBJ[String(c.objective ?? "").toUpperCase()] ?? "SALES";
  const sets = allAdsets.filter((s) => String(s.campaign_id) === String(c.id));
  const campaignBudget = !!(Number(c.daily_budget) || Number(c.lifetime_budget));
  const cBudgetType = Number(c.lifetime_budget) ? "lifetime" : "daily";
  let pageFbId = "";

  const adsets = sets.map((s) => {
    const t = s.targeting ?? {};
    const po = s.promoted_object ?? {};
    if (po.page_id && !pageFbId) pageFbId = String(po.page_id);
    const goal = String(s.optimization_goal ?? "");
    const msging = goal === "CONVERSATIONS";
    const ads = allAds.filter((a) => String(a.adset_id) === String(s.id));
    for (const a of ads) {
      const p = a.creative?.object_story_spec?.page_id ?? a.page_id ?? String(a.creative?.effective_object_story_id ?? "").split("_")[0];
      if (p && !pageFbId) pageFbId = String(p);
    }
    const bt = Number(s.lifetime_budget) ? "lifetime" : "daily";
    const genders: number[] = t.genders ?? [];
    return {
      adsetName: s.name ?? "Ad set",
      location: msging && (objective === "SALES" || objective === "LEADS") ? "MESSAGING" : "WEBSITE",
      pixelId: po.pixel_id ? String(po.pixel_id) : "",
      customEvent: EVENT[String(po.custom_event_type ?? "")] ?? "PURCHASE",
      startTime: toLocal(s.start_time), hasEnd: false, endTime: "",
      countries: geo(t), ageMin: String(t.age_min ?? 18), ageMax: String(t.age_max ?? 65),
      gender: genders.length === 1 ? (genders[0] === 1 ? "male" : "female") : "all",
      interests: interestsOf(t),
      connections: t.connections?.length ? "include" : t.excluded_connections?.length ? "exclude" : "all",
      mainDest: "WEBSITE", phone: "",
      engLoc: objective === "ENGAGEMENT" ? (msging ? "MESSAGING" : goal === "PAGE_LIKES" ? "PAGE_LIKES" : goal === "LINK_CLICKS" ? "WEBSITE" : "ON_AD") : "MESSAGING",
      destMode: "auto", dests: ["MESSENGER"],
      budgetType: bt, amount: money(s[`${bt}_budget`]) || "5.00",
      bidStrategy: s.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP", bidAmount: s.bid_amount ? money(s.bid_amount) : "",
      ads: ads.length ? ads.map((a) => adFrom(a, objective)) : [adFrom({ name: "New Ad" }, objective)],
    };
  });

  const page = pages.find((p) => String(p.page_id) === pageFbId);
  return {
    phase: "edit", pick: objective, objective, level: 0, selPos: { a: 0, d: 0 },
    accId: c.ad_account_db_id, pageDbId: page?.id ?? "",
    campaignName: `${c.name ?? "Campaign"} - Copy`.slice(0, 200),
    budgetLevel: campaignBudget ? "campaign" : "adset",
    cBudgetType, cAmount: campaignBudget ? money(c[`${cBudgetType}_budget`]) : "5.00",
    cBidStrategy: c.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP", cBidAmount: "", special: [],
    adsets,
  };
}
