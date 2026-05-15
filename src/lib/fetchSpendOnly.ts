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
export type RateLimitedDetail = {
  id: string;
  http_code: number | null;
  error_code: number | null;
  error_subcode: number | null;
  error_type: string | null;
  error_message: string;
  is_rate_limit: boolean;
  reason: string;
};

export async function fetchSpendOnly(
  ids: string[],
  options?: { date_from?: string; date_to?: string },
): Promise<{
  spend: Record<string, number>;
  daily: Record<string, { date: string; spend: number }[]>;
  rate_limited: string[];
  rate_limited_details: RateLimitedDetail[];
  total: number;
  meta_calls: number;
  proxy_ip: string | null;
}> {
  if (!ids.length) return { spend: {}, daily: {}, rate_limited: [], rate_limited_details: [], total: 0, meta_calls: 0, proxy_ip: null };

  const CHUNK = 500;
  const merged: Record<string, number> = {};
  const mergedDaily: Record<string, { date: string; spend: number }[]> = {};
  const allRate: string[] = [];
  const allRateDetails: RateLimitedDetail[] = [];
  let metaCalls = 0;
  let proxyIp: string | null = null;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const body: any = { ad_account_ids: slice };
    if (options?.date_from) body.date_from = options.date_from;
    if (options?.date_to) body.date_to = options.date_to;

    const { data, error } = await supabase.functions.invoke("get-spend-only", { body });
    if (error) throw error;
    if (data?.spend) Object.assign(merged, data.spend);
    if (data?.daily) Object.assign(mergedDaily, data.daily);
    if (Array.isArray(data?.rate_limited)) allRate.push(...data.rate_limited);
    if (Array.isArray(data?.rate_limited_details)) allRateDetails.push(...data.rate_limited_details);
    if (data?.meta_calls?.total) metaCalls += Number(data.meta_calls.total) || 0;
    if (data?.meta_calls?.proxy_ip && !proxyIp) proxyIp = data.meta_calls.proxy_ip;
  }

  const total =
    Math.round(Object.values(merged).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100;

  return { spend: merged, daily: mergedDaily, rate_limited: allRate, rate_limited_details: allRateDetails, total, meta_calls: metaCalls, proxy_ip: proxyIp };
}