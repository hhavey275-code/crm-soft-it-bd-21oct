import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";

async function metaFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!url.startsWith("https://graph.facebook.com/")) return fetch(url, options);
  const proxySecret = Deno.env.get("META_PROXY_SECRET");
  const proxyUrl = Deno.env.get("META_PROXY_URL") || DEFAULT_META_PROXY_URL;
  if (proxySecret && proxyUrl) {
    try {
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-proxy-secret": proxySecret },
        body: JSON.stringify({ url, method: options.method ?? "GET" })
      });
      const text = await res.text();
      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");
      if (!looksLikeHtml) return new Response(text, { status: res.status, headers: res.headers });
    } catch (e) {
      console.warn("Proxy failed, falling back:", e);
    }
  }
  return fetch(url, options);
}

async function decryptToken(stored: string, secret: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("bm-token-enc-v1"), iterations: 100000, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
    const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(dec);
  } catch {
    return stored;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleData } = await supabase
      .from("user_roles").select("role").eq("user_id", user.id)
      .in("role", ["admin", "superadmin"]).limit(1);
    if (!roleData || roleData.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { business_manager_id, ad_account_id } = body ?? {};
    if (!business_manager_id || !ad_account_id) {
      return new Response(JSON.stringify({ error: "business_manager_id and ad_account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Normalize: strip "act_" prefix; require numeric
    const cleanId = String(ad_account_id).trim().replace(/^act_/i, "");
    if (!/^\d+$/.test(cleanId)) {
      return new Response(JSON.stringify({ error: "Ad account ID must be numeric (e.g. 1234567890 or act_1234567890)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: bm, error: bmErr } = await supabase
      .from("business_managers").select("*").eq("id", business_manager_id).single();
    if (bmErr || !bm) {
      return new Response(JSON.stringify({ error: "Business Manager not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const accessToken = await decryptToken(bm.access_token, serviceKey);

    // Fetch the account from Meta to get current details (status, spend cap, name, etc.)
    const fields = "id,name,account_id,account_status,spend_cap,amount_spent,business_name";
    const url = `https://graph.facebook.com/v23.0/act_${cleanId}?fields=${fields}&access_token=${accessToken}`;
    const res = await metaFetch(url);
    const data = await res.json();
    if (data.error) {
      return new Response(JSON.stringify({
        error: `Meta API error: ${data.error.message}. The selected BM token may not have access to this account.`
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accountId = data.account_id || cleanId;
    const row = {
      account_id: `act_${accountId}`,
      account_name: data.name || `Ad Account ${accountId}`,
      business_manager_id: bm.id,
      business_name: data.business_name || null,
      status: data.account_status === 1 ? "active" : data.account_status === 2 ? "disabled" : "pending",
      spend_cap: Number(data.spend_cap ?? 0) / 100,
      amount_spent: Number(data.amount_spent ?? 0) / 100
    };

    const { error: upsertErr } = await supabase.from("ad_accounts").upsert(row, { onConflict: "account_id" });
    if (upsertErr) {
      return new Response(JSON.stringify({ error: upsertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, account: row }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("add-ad-account-manual error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: corsHeaders });
  }
});
