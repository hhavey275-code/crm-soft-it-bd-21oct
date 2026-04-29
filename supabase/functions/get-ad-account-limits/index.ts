import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  metaFetch,
  resetMetaCounters,
  getLastMetaIp,
  getLastMetaVia,
  getMetaProxyCount,
  getMetaDirectCount,
  getMetaProxyFailReasons,
} from "../_shared/meta-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

// Meta returns these account money fields in minor units (cents).
function normalizeAmount(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  resetMetaCounters();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized - invalid token" }, 401);
    const userId = claimsData.claims.sub;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { ad_account_id } = await req.json().catch(() => ({}));
    if (!ad_account_id) return json({ error: "ad_account_id required" }, 400);

    // --- Role / access check ---
    const { data: userRole } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).single();
    const isAdmin = userRole?.role === "admin" || userRole?.role === "superadmin";

    if (!isAdmin) {
      const { data: assignment } = await supabase
        .from("user_ad_accounts").select("id")
        .eq("user_id", userId).eq("ad_account_id", ad_account_id).maybeSingle();
      if (!assignment) return json({ error: "Forbidden" }, 403);
    }

    // --- Fetch ad account + BM token ---
    const { data: account, error: accErr } = await supabase
      .from("ad_accounts")
      .select("id, account_id, business_managers!inner(access_token)")
      .eq("id", ad_account_id)
      .single();
    if (accErr || !account) return json({ error: "Ad account not found" }, 404);

    const rawToken = (account as any).business_managers?.access_token;
    if (!rawToken) return json({ error: "BM access token missing" }, 400);
    const bmToken = await decryptToken(rawToken, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const actId = (account as any).account_id as string;

    // --- Meta call (proxy via metaFetch) ---
    // adtrust_dsl (Meta-imposed Daily Spending Limit) is only exposed on older
    // Graph API versions. v19.0 still returns it for accounts that have one.
    // Newer (v20+) versions silently dropped this field.
    const fields = "adtrust_dsl,min_daily_budget,currency,balance,spend_cap,amount_spent";
    const url = `https://graph.facebook.com/v19.0/${actId}?fields=${fields}&access_token=${encodeURIComponent(bmToken)}`;
    const res = await metaFetch(url, { method: "GET" });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || body?.error) {
      return json({
        error: body?.error?.message || `Meta returned ${res.status}`,
        meta: {
          via: getLastMetaVia(),
          ip: getLastMetaIp(),
          proxy_calls: getMetaProxyCount(),
          direct_calls: getMetaDirectCount(),
          proxy_fails: getMetaProxyFailReasons(),
        },
      }, 502);
    }

    const dailySpendLimit = normalizeAmount(body?.adtrust_dsl);
    const minDailyBudget = normalizeAmount(body?.min_daily_budget);
    const currency = body?.currency || "USD";
    const balance = normalizeAmount(body?.balance);
    const spendCap = normalizeAmount(body?.spend_cap);
    const amountSpent = normalizeAmount(body?.amount_spent);

    return json({
      ok: true,
      data: {
        daily_spend_limit: dailySpendLimit > 0 ? dailySpendLimit : null,
        daily_spend_limit_available: dailySpendLimit > 0,
        unavailable_reason: dailySpendLimit > 0
          ? null
          : "Meta has not set a daily spending limit on this ad account, or the account is on monthly invoicing.",
        raw_adtrust_dsl: body?.adtrust_dsl ?? null,
        min_daily_budget: minDailyBudget,
        currency,
        balance,
        spend_cap: spendCap,
        amount_spent: amountSpent,
        fetched_at: new Date().toISOString(),
      },
      meta: {
        via: getLastMetaVia(),
        ip: getLastMetaIp(),
        proxy_calls: getMetaProxyCount(),
        direct_calls: getMetaDirectCount(),
        proxy_fails: getMetaProxyFailReasons(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});