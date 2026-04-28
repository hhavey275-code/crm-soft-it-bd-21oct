import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  metaFetch,
  resetMetaCounters,
  getLastMetaVia,
  getLastMetaIp,
} from "../_shared/meta-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_API_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

async function decryptToken(stored: string, secret: string) {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Reset shared meta counters per invocation
  resetMetaCounters();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const token = authHeader.replace("Bearer ", "");

  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claimsData.claims.sub as string;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const accountId: string = body?.accountId;
    const statusFilter: string = (body?.statusFilter as string) ?? "all";
    const dateFrom: string = body?.dateFrom;
    const dateTo: string = body?.dateTo;

    if (!accountId || !dateFrom || !dateTo) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Access check: admin/superadmin/agency or assigned to the ad account
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some(
      (r: any) => r.role === "admin" || r.role === "superadmin" || r.role === "agency",
    );
    if (!isAdmin) {
      const { data: assignment } = await supabase
        .from("user_ad_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("ad_account_id", accountId)
        .maybeSingle();
      if (!assignment) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: account, error: accountError } = await supabase
      .from("ad_accounts")
      .select("id, account_id, account_name, business_manager_id, business_managers(access_token)")
      .eq("id", accountId)
      .maybeSingle();

    if (accountError || !account) {
      return new Response(JSON.stringify({ error: "Ad account not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const businessManager = Array.isArray((account as any).business_managers)
      ? (account as any).business_managers[0]
      : (account as any).business_managers;
    if (!businessManager?.access_token) {
      return new Response(JSON.stringify({ error: "Business Manager token not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await decryptToken(businessManager.access_token, serviceKey);
    const actId = (account as any).account_id.startsWith("act_")
      ? (account as any).account_id
      : `act_${(account as any).account_id}`;
    const encodedToken = encodeURIComponent(accessToken);

    const campaignsUrl = `${GRAPH_BASE}/${actId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time&limit=100&access_token=${encodedToken}`;
    const insightsUrl = `${GRAPH_BASE}/${actId}/insights?level=campaign&fields=campaign_id,spend,impressions,clicks,cpc,ctr,cpm,actions&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}&limit=100&access_token=${encodedToken}`;

    const [campaignsRes, insightsRes, profileRes] = await Promise.all([
      metaFetch(campaignsUrl),
      metaFetch(insightsUrl),
      supabase.from("profiles").select("full_name, email").eq("user_id", userId).maybeSingle(),
    ]);

    const campaignsJson = await campaignsRes.json().catch(() => ({}));
    if (!campaignsRes.ok) {
      return new Response(
        JSON.stringify({ error: campaignsJson?.error?.message || "Failed to fetch campaigns" }),
        { status: campaignsRes.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const insightsJson = await insightsRes.json().catch(() => ({ data: [] }));
    const insightsMap = new Map<string, any>();
    for (const row of insightsJson?.data ?? []) {
      if (row?.campaign_id) insightsMap.set(row.campaign_id, row);
    }

    let campaigns = (campaignsJson?.data ?? []).map((campaign: any) => ({
      ...campaign,
      insights: insightsMap.get(campaign.id),
    }));

    if (statusFilter !== "all") {
      const normalized = String(statusFilter).toLowerCase();
      campaigns = campaigns.filter((c: any) =>
        String(c.effective_status || "").toLowerCase().includes(normalized),
      );
    }

    const userName =
      profileRes.data?.full_name || profileRes.data?.email || "system";
    await supabase.from("system_logs").insert({
      user_id: userId,
      user_name: userName,
      action: "Ads Manager Campaign Fetch",
      details: `Fetched ${campaigns.length} campaigns for ${(account as any).account_name} (${actId}) via ${lastMetaVia}${lastMetaIp ? ` [IP: ${lastMetaIp}]` : ""}`,
    } as any);

    return new Response(
      JSON.stringify({
        campaigns,
        fetchedAt: new Date().toISOString(),
        proxyIp: lastMetaIp,
        via: lastMetaVia,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("ads-manager-campaigns error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Failed to fetch campaigns" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});