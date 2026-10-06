import { supabase } from "@/integrations/supabase/client";

export async function managedAds<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/managed-ads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: "সার্ভার থেকে উত্তর পাওয়া যায়নি" }));
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
