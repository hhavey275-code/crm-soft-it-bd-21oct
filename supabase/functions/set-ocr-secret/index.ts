import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// NOTE: Updates Supabase secret via Management API and mirrors a "configured" flag in site_settings.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: roles } = await adminClient.from("user_roles").select("role").eq("user_id", userData.user.id);
    const isSuperadmin = (roles || []).some((r: any) => r.role === "superadmin");
    if (!isSuperadmin) return new Response(JSON.stringify({ error: "forbidden — superadmin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { provider, api_key, action, priority } = await req.json();

    // Save priority order
    if (action === "save_priority") {
      if (!Array.isArray(priority)) return new Response(JSON.stringify({ error: "priority must be an array" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const allowed = priority.filter((p: string) => ["lovable", "gemini", "openai"].includes(p));
      await adminClient.from("site_settings").upsert({ key: "ocr_fallback_priority", value: JSON.stringify(allowed), updated_at: new Date().toISOString() }, { onConflict: "key" });
      return new Response(JSON.stringify({ ok: true, priority: allowed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!provider || !["openai", "gemini"].includes(provider)) {
      return new Response(JSON.stringify({ error: "provider must be openai or gemini" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!api_key || typeof api_key !== "string" || api_key.length < 10) {
      return new Response(JSON.stringify({ error: "valid api_key required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const secretName = provider === "openai" ? "OPENAI_API_KEY" : "USER_GEMINI_API_KEY";

    // Update Supabase secret via Management API
    const sbToken = Deno.env.get("SB_MGMT_TOKEN") || Deno.env.get("SB_MGMT_PAT");
    const projectRef = (supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1];
    if (!sbToken || !projectRef) {
      return new Response(JSON.stringify({ error: "management token not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const mgmtResp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/secrets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sbToken}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ name: secretName, value: api_key }]),
    });
    if (!mgmtResp.ok) {
      const t = await mgmtResp.text();
      return new Response(JSON.stringify({ error: `failed to save secret: ${t.slice(0, 200)}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mirror flag in site_settings
    const flagKey = provider === "openai" ? "ocr_openai_configured" : "ocr_gemini_configured";
    await adminClient.from("site_settings").upsert({ key: flagKey, value: "true", updated_at: new Date().toISOString() }, { onConflict: "key" });

    await adminClient.from("system_logs").insert({
      action: "OCR Secret Updated",
      status: "success",
      user_id: userData.user.id,
      details: `provider=${provider}`,
    });

    return new Response(JSON.stringify({ ok: true, provider, configured: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("set-ocr-secret error:", e?.message);
    return new Response(JSON.stringify({ error: e?.message || "internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});