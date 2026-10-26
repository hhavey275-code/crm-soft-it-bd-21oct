import { supabase } from "@/integrations/supabase/client";

// Admin "view as client" inside Client Details: every My Ads request carries asUserId.
// The server only honours it for admins, so clients cannot use it.
let viewAsUserId: string | null = null;
export function setManagedAdsViewAs(id: string | null) { viewAsUserId = id; }

export async function managedAds<T = any>(rawBody: Record<string, unknown>): Promise<T> {
  const body = viewAsUserId && rawBody.asUserId === undefined ? { ...rawBody, asUserId: viewAsUserId } : rawBody;
  let { data: { session } } = await supabase.auth.getSession();
  if (!session || (session.expires_at ?? 0) * 1000 < Date.now() + 60_000) {
    const r = await supabase.auth.refreshSession();
    if (r.data.session) session = r.data.session;
  }
  const res = await fetch("/api/managed-ads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: "সার্ভার থেকে উত্তর পাওয়া যায়নি" }));
  if (res.status === 401) throw new Error("লগইন যাচাই হয়নি — একবার Sign out করে আবার লগইন করুন");
  if (!res.ok || json?.error) throw new Error(json?.error || "Request failed");
  return json as T;
}

export const RESULT_ACTIONS = [
  "onsite_conversion.messaging_conversation_started_7d",
  "link_click",
  "post_engagement",
  "lead",
  "offsite_conversion.fb_pixel_purchase",
];

const PURCHASE_KEYS = ["offsite_conversion.fb_pixel_purchase", "omni_purchase", "purchase", "onsite_web_purchase"];
const MESSAGE_KEYS = ["onsite_conversion.messaging_conversation_started_7d"];
const LEAD_KEYS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const TRAFFIC_KEYS = ["link_click", "landing_page_view"];

/** Which result actions count for a campaign objective (or ad set optimization goal). */
export function resultKeysFor(objective?: string | null, goal?: string | null): string[] {
  const o = String(objective || "").toUpperCase(), g = String(goal || "").toUpperCase();
  if (g.includes("CONVERSATION") || g === "REPLIES") return MESSAGE_KEYS;
  if (g === "OFFSITE_CONVERSIONS" || g === "VALUE") return PURCHASE_KEYS;
  if (g.includes("LEAD")) return LEAD_KEYS;
  if (o.includes("SALES") || o === "CONVERSIONS" || o === "PRODUCT_CATALOG_SALES") return PURCHASE_KEYS;
  if (o.includes("LEAD")) return LEAD_KEYS;
  if (o === "MESSAGES") return MESSAGE_KEYS;
  if (o.includes("ENGAGEMENT")) return [...MESSAGE_KEYS, "post_engagement"];
  if (o.includes("TRAFFIC") || o === "LINK_CLICKS") return TRAFFIC_KEYS;
  if (o.includes("AWARENESS") || o === "REACH" || o === "BRAND_AWARENESS") return [];
  return RESULT_ACTIONS;
}

/**
 * Results follow the objective like Ads Manager: a Sales campaign counts only purchases,
 * never link clicks. Without an objective hint the old generic order is used.
 */
export function resultOf(insights: any, hint?: { objective?: string | null; goal?: string | null }): { count: number; cost: number | null } {
  const actions: any[] = insights?.actions ?? [];
  const keys = hint ? resultKeysFor(hint.objective, hint.goal) : RESULT_ACTIONS;
  for (const key of keys) {
    const a = actions.find((x) => x.action_type === key);
    if (a) {
      const count = Number(a.value) || 0;
      const spend = Number(insights?.spend) || 0;
      return { count, cost: count ? spend / count : null };
    }
  }
  return { count: 0, cost: null };
}

const PURCHASE = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
export function salesOf(insights: any): { purchases: number; value: number; roas: number | null; cpp: number | null } {
  const pick = (arr: any[] | undefined) => { for (const k of PURCHASE) { const a = (arr ?? []).find((x) => x.action_type === k); if (a) return Number(a.value) || 0; } return 0; };
  const purchases = pick(insights?.actions);
  const value = pick(insights?.action_values);
  const spend = Number(insights?.spend) || 0;
  const r = pick(insights?.purchase_roas);
  return { purchases, value, roas: r || (spend && value ? value / spend : null), cpp: purchases ? spend / purchases : null };
}
