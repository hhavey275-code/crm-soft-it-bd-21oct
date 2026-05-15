// Lightweight spend-only fetcher.
//
// Goal: dashboard / spend-report style screens only need a "spend" number per
// account for an optional date range. The full `get-account-insights` function
// fires 4-5 Meta calls per account (balance, cards, campaigns, funding source).
// That's wasteful when the UI only displays the spend value.
//
// This function uses Meta's Graph API batch endpoint:
//   POST https://graph.facebook.com/v23.0/  body: access_token + batch=[...up to 50]
// → 50 accounts == 1 HTTP request, ~95% fewer calls than the full insights path.
//
// Inputs:
//   { ad_account_ids: string[], date_from?: "YYYY-MM-DD", date_to?: "YYYY-MM-DD" }
//   - if no date range provided → returns today's spend (BD calendar)
// Output:
//   { spend: { [internal_ad_account_id]: number }, rate_limited: string[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  metaFetch,
  resetMetaCounters,
  metaCallSummary,
  getMetaProxyCount,
  getMetaDirectCount,
  getLastMetaIp,
  getMetaProxyFailReasons,
} from "../_shared/meta-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 50; // Meta's batch endpoint hard limit

function bdDateString(date = new Date()) {
  const bdMs = date.getTime() + 6 * 60 * 60 * 1000;
  return new Date(bdMs).toISOString().slice(0, 10);
}

async function decryptToken(stored: string, secret: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("bm-token-enc-v1"),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch {
    return stored;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseSpendFromBatchBody(body: string): { total: number; daily: { date: string; spend: number }[] } {
  try {
    const parsed = JSON.parse(body);
    const rows = parsed?.data;
    if (!Array.isArray(rows)) return { total: 0, daily: [] };
    let total = 0;
    const daily: { date: string; spend: number }[] = [];
    for (const r of rows) {
      const s = Number(r?.spend);
      if (Number.isFinite(s)) {
        total += s;
        const date = r?.date_start || r?.date_stop;
        if (date) daily.push({ date, spend: Math.round(s * 100) / 100 });
      }
    }
    return { total: Math.round(total * 100) / 100, daily };
  } catch {
    return { total: 0, daily: [] };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  resetMetaCounters();
  const started = Date.now();

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, serviceKey);

    // Resolve caller user id from JWT (best-effort, never fails the request)
    let callerUserId: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token) {
        const { data: userRes } = await supabase.auth.getUser(token);
        callerUserId = userRes?.user?.id ?? null;
      }
    } catch {
      callerUserId = null;
    }

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ad_account_ids) ? body.ad_account_ids : [];
    const dateFrom: string | undefined = body?.date_from;
    const dateTo: string | undefined = body?.date_to;

    if (!ids.length) {
      return new Response(JSON.stringify({ spend: {}, rate_limited: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull account_id + token for the requested internal IDs (in chunks of 200 to dodge URL limits)
    type AcctRow = {
      id: string;
      account_id: string;
      business_manager_id: string | null;
      business_managers: { access_token: string | null } | null;
    };
    const accounts: AcctRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("id, account_id, business_manager_id, business_managers(access_token)")
        .in("id", slice);
      if (error) throw error;
      if (data) accounts.push(...(data as any));
    }

    // Determine the time_range — single object, reused for every account in the batch
    const since = dateFrom || bdDateString();
    const until = dateTo || bdDateString();
    const timeRange = JSON.stringify({ since, until });

    // Group by BM access token — each batch needs ONE access_token
    const groups = new Map<string, AcctRow[]>();
    const noToken: AcctRow[] = [];
    for (const a of accounts) {
      const tok = a.business_managers?.access_token;
      if (!tok) {
        noToken.push(a);
        continue;
      }
      const arr = groups.get(tok) ?? [];
      arr.push(a);
      groups.set(tok, arr);
    }

    const spendMap: Record<string, number> = {};
    const dailyMap: Record<string, { date: string; spend: number }[]> = {};
    const rateLimited: string[] = [];
    type RLDetail = {
      id: string;
      http_code: number | null;
      error_code: number | null;
      error_subcode: number | null;
      error_type: string | null;
      error_message: string;
      is_rate_limit: boolean;
      reason: string;
    };
    const rateLimitedDetails: RLDetail[] = [];

    function classifyError(httpCode: number | null, errCode: number | null, errSub: number | null, msg: string): { is_rl: boolean; reason: string } {
      const m = (msg || "").toLowerCase();
      // Meta rate-limit error codes
      const rlCodes = new Set([4, 17, 32, 613]);
      const rlSub = new Set([2446079, 1487742]);
      if ((errCode != null && rlCodes.has(errCode)) || (errSub != null && rlSub.has(errSub)) || /rate|limit|too many|throttl/i.test(msg)) {
        return { is_rl: true, reason: msg || "Rate limited by Meta" };
      }
      if (errCode === 190) return { is_rl: false, reason: "Invalid / expired access token" };
      if (errCode === 100) return { is_rl: false, reason: msg || "Invalid parameter" };
      if (errCode === 200 || /permission/.test(m)) return { is_rl: false, reason: "Permission denied (token lacks ads_read)" };
      if (errCode === 272 || /disabled|closed/.test(m)) return { is_rl: false, reason: msg || "Ad account disabled/closed" };
      if (httpCode && httpCode >= 500) return { is_rl: false, reason: `Meta server error (${httpCode})` };
      if (msg) return { is_rl: false, reason: msg };
      return { is_rl: false, reason: "Unknown Meta error" };
    }

    function pushFail(id: string, httpCode: number | null, body: any) {
      let errCode: number | null = null;
      let errSub: number | null = null;
      let errType: string | null = null;
      let msg = "";
      try {
        const parsed = typeof body === "string" ? JSON.parse(body) : body;
        const e = parsed?.error;
        if (e) {
          errCode = e.code ?? null;
          errSub = e.error_subcode ?? null;
          errType = e.type ?? null;
          msg = e.message || e.error_user_msg || "";
        }
      } catch { /* ignore */ }
      const cls = classifyError(httpCode, errCode, errSub, msg);
      rateLimited.push(id);
      rateLimitedDetails.push({
        id,
        http_code: httpCode,
        error_code: errCode,
        error_subcode: errSub,
        error_type: errType,
        error_message: msg,
        is_rate_limit: cls.is_rl,
        reason: cls.reason,
      });
    }

    // Initialise zero so caller always gets every requested id back
    for (const a of accounts) { spendMap[a.id] = 0; dailyMap[a.id] = []; }
    for (const a of noToken) {
      spendMap[a.id] = 0;
      dailyMap[a.id] = [];
      rateLimited.push(a.id);
      rateLimitedDetails.push({
        id: a.id,
        http_code: null,
        error_code: null,
        error_subcode: null,
        error_type: null,
        error_message: "",
        is_rate_limit: false,
        reason: "Business Manager has no access token",
      });
    }

    // Fire batches in parallel within a group, but cap concurrency to 4
    // to stay polite to Meta and the proxy.
    const tasks: Array<() => Promise<void>> = [];

    for (const [encToken, groupAccounts] of groups.entries()) {
      const accessToken = await decryptToken(encToken, serviceKey);
      const chunks = chunk(groupAccounts, BATCH_SIZE);

      for (const c of chunks) {
        tasks.push(async () => {
          // Build the batch payload
          const batchPayload = c.map((acc) => ({
            method: "GET",
            relative_url:
              `${acc.account_id}/insights` +
              `?fields=spend` +
              `&time_range=${encodeURIComponent(timeRange)}` +
              `&time_increment=1`,
          }));

          const form = new URLSearchParams();
          form.set("access_token", accessToken);
          form.set("include_headers", "false");
          form.set("batch", JSON.stringify(batchPayload));

          try {
            const res = await metaFetch("https://graph.facebook.com/v23.0/", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: form,
            });

            if (!res.ok) {
              // whole batch failed — read body once and apply to all
              let bodyTxt = "";
              try { bodyTxt = await res.text(); } catch { /* ignore */ }
              for (const acc of c) pushFail(acc.id, res.status, bodyTxt);
              return;
            }

            const json = await res.json();
            // batch responses arrive as an array, same order as the request
            if (!Array.isArray(json)) {
              for (const acc of c) pushFail(acc.id, res.status, json);
              return;
            }

            for (let i = 0; i < c.length; i++) {
              const item = json[i];
              if (!item) {
                pushFail(c[i].id, null, { error: { message: "No batch item returned" } });
                continue;
              }
              if (item.code && item.code >= 200 && item.code < 300 && typeof item.body === "string") {
                const parsed = parseSpendFromBatchBody(item.body);
                spendMap[c[i].id] = parsed.total;
                dailyMap[c[i].id] = parsed.daily;
              } else {
                pushFail(c[i].id, item.code ?? null, item.body);
              }
            }
          } catch (err) {
            console.error("Batch error:", err);
            const msg = err instanceof Error ? err.message : String(err);
            for (const acc of c) pushFail(acc.id, null, { error: { message: msg } });
          }
        });
      }
    }

    // Run with concurrency cap = 4
    const CONCURRENCY = 4;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const idx = cursor++;
        await tasks[idx]();
      }
    });
    await Promise.all(workers);

    const ms = Date.now() - started;
    console.log(
      `get-spend-only: ${ids.length} accounts → ${tasks.length} batch call(s) in ${ms}ms${metaCallSummary(" ")}`,
    );

    // Persist per-day totals into daily_spend_snapshots so the monthly graph
    // stays in sync with whatever range the admin just queried. Service role
    // bypasses RLS, so this always writes (the client-side upsert was being
    // silently dropped by RLS in some sessions, leaving stale graph values).
    try {
      const dayTotals: Record<string, number> = {};
      for (const days of Object.values(dailyMap)) {
        for (const d of days || []) {
          if (!d?.date) continue;
          const s = Number(d.spend) || 0;
          dayTotals[d.date] = (dayTotals[d.date] || 0) + s;
        }
      }
      const rows = Object.entries(dayTotals).map(([date, spend]) => ({
        snapshot_date: date,
        total_spend: Math.round(spend * 100) / 100,
        account_count: ids.length,
      }));
      if (rows.length) {
        const { error: upsertErr } = await supabase
          .from("daily_spend_snapshots")
          .upsert(rows, { onConflict: "snapshot_date" });
        if (upsertErr) {
          console.warn("daily_spend_snapshots upsert failed:", upsertErr.message);
        } else {
          console.log(`daily_spend_snapshots: upserted ${rows.length} day(s)`);
        }
      }
    } catch (snapErr) {
      console.warn("daily_spend_snapshots persist error:", snapErr);
    }

    // Write to system_logs so admins can see who checked spend, when, and via which proxy IP.
    try {
      let userName: string | null = "system";
      if (callerUserId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", callerUserId)
          .maybeSingle();
        userName = prof?.full_name || prof?.email || "user";
      }
      const proxyCalls = getMetaProxyCount();
      const directCalls = getMetaDirectCount();
      const totalCalls = proxyCalls + directCalls;
      const failReasons = getMetaProxyFailReasons();
      const failNote = failReasons.length ? ` | proxy_fails=[${failReasons.join("; ")}]` : "";
      const rangeLabel = `${since}..${until}`;
      await supabase.from("system_logs").insert({
        user_id: callerUserId,
        user_name: userName,
        action: "Meta Spend Check",
        details: `Checked spend for ${ids.length} account(s) [range=${rangeLabel}] | calls=${totalCalls} (proxy=${proxyCalls}, direct=${directCalls}) | proxy_ip=${getLastMetaIp() ?? "n/a"}${failNote}`,
      });
    } catch (logErr) {
      console.warn("system_logs insert (Meta Spend Check) failed:", logErr);
    }

    return new Response(
      JSON.stringify({
        spend: spendMap,
        daily: dailyMap,
        rate_limited: rateLimited,
        meta_calls: {
          proxy: getMetaProxyCount(),
          direct: getMetaDirectCount(),
          total: getMetaProxyCount() + getMetaDirectCount(),
          proxy_ip: getLastMetaIp(),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("get-spend-only error:", msg);
    return new Response(JSON.stringify({ error: msg, spend: {}, rate_limited: [], meta_calls: { proxy: 0, direct: 0, total: 0, proxy_ip: null } }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});