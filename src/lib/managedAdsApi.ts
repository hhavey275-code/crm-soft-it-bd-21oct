import { supabase } from "@/integrations/supabase/client";

export async function managedAds<T = any>(body: Record<string, unknown>): Promise<T> {
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

export function resultOf(insights: any): { count: number; cost: number | null } {
  const actions: any[] = insights?.actions ?? [];
  for (const key of RESULT_ACTIONS) {
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
