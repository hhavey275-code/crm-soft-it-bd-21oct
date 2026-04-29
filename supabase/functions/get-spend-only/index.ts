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

function parseSpendFromBatchBody(body: string): number {
  try {
    const parsed = JSON.parse(body);
    const rows = parsed?.data;
    if (!Array.isArray(rows)) return 0;
    let total = 0;
    for (const r of rows) {
      const s = Number(r?.spend);
      if (Number.isFinite(s)) total += s;
    }
    return Math.round(total * 100) / 100;
  } catch {
    return 0;
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
    const rateLimited: string[] = [];

    // Initialise zero so caller always gets every requested id back
    for (const a of accounts) spendMap[a.id] = 0;
    for (const a of noToken) spendMap[a.id] = 0;

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
              // whole batch failed — mark all as rate_limited so caller knows
              for (const acc of c) rateLimited.push(acc.id);
              return;
            }

            const json = await res.json();
            // batch responses arrive as an array, same order as the request
            if (!Array.isArray(json)) {
              for (const acc of c) rateLimited.push(acc.id);
              return;
            }

            for (let i = 0; i < c.length; i++) {
              const item = json[i];
              if (!item) continue;
              if (item.code && item.code >= 200 && item.code < 300 && typeof item.body === "string") {
                spendMap[c[i].id] = parseSpendFromBatchBody(item.body);
              } else {
                rateLimited.push(c[i].id);
              }
            }
          } catch (err) {
            console.error("Batch error:", err);
            for (const acc of c) rateLimited.push(acc.id);
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

    return new Response(
      JSON.stringify({ spend: spendMap, rate_limited: rateLimited }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("get-spend-only error:", msg);
    return new Response(JSON.stringify({ error: msg, spend: {}, rate_limited: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});