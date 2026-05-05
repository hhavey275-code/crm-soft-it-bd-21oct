import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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
    if (claimsError || !claimsData?.claims) return json({ error: "Invalid token" }, 401);
    const userId = claimsData.claims.sub;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    if (!roleSet.has("admin") && !roleSet.has("superadmin")) {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    const { data: rows, error } = await supabase
      .from("ad_account_sync_requests")
      .select("id, ad_account_id, requested_at, ad_accounts!inner(account_id, account_name, platform)")
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(100);
    if (error) return json({ error: error.message }, 500);

    const requests = (rows ?? [])
      .filter((r: any) => r.ad_accounts?.platform === "meta")
      .map((r: any) => ({
        id: r.id,
        ad_account_id: r.ad_account_id,
        meta_account_id: String(r.ad_accounts.account_id || "").replace(/^act_/, ""),
        account_name: r.ad_accounts.account_name,
        requested_at: r.requested_at,
      }));

    return json({ ok: true, requests, count: requests.length });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
