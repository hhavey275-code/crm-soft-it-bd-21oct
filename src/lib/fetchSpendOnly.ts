import { supabase } from "@/integrations/supabase/client";

/**
 * Lightweight spend-only fetch — calls the `get-spend-only` edge function
 * which uses Meta's Batch API (50 accounts per HTTP request, only `spend`
 * field). Use this for screens that only need a spend number per account
 * (Admin Dashboard date-range card, monthly chart, Spend Report).
 *
 * Use the heavier `chunkedMetaSync` only when you also need balance, cards,
 * funding source, campaigns, etc. (e.g. "Update All from Meta").
 */
export async function fetchSpendOnly(
  ids: string[],
  options?: { date_from?: string; date_to?: string },
): Promise<{
  spend: Record<string, number>;
  rate_limited: string[];
  total: number;
}> {
  if (!ids.length) return { spend: {}, rate_limited: [], total: 0 };

  // Internal chunking — keep payloads small even though the edge function
  // groups by BM internally. 500 ids per invocation is well within limits.
  const CHUNK = 500;
  const merged: Record<string, number> = {};
  const allRate: string[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const body: any = { ad_account_ids: slice };
    if (options?.date_from) body.date_from = options.date_from;
    if (options?.date_to) body.date_to = options.date_to;

    const { data, error } = await supabase.functions.invoke("get-spend-only", { body });
    if (error) throw error;
    if (data?.spend) Object.assign(merged, data.spend);
    if (Array.isArray(data?.rate_limited)) allRate.push(...data.rate_limited);
  }

  const total =
    Math.round(Object.values(merged).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100;

  return { spend: merged, rate_limited: allRate, total };
}