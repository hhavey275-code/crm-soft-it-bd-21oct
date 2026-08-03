import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: callerRoles } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
    const roles = new Set((callerRoles ?? []).map((r: any) => r.role));
    const isSuperAdmin = roles.has("superadmin");
    const isAdmin = roles.has("admin") || isSuperAdmin;
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const { target_user_id } = await req.json();
    if (!target_user_id) return json({ error: "target_user_id required" }, 400);
    if (target_user_id === callerId) return json({ error: "You cannot delete your own account" }, 400);

    const { data: targetRoles } = await supabase.from("user_roles").select("role").eq("user_id", target_user_id);
    const tRoles = new Set((targetRoles ?? []).map((r: any) => r.role));
    if (tRoles.has("superadmin")) return json({ error: "Superadmin accounts cannot be deleted" }, 403);
    if (tRoles.has("admin") && !isSuperAdmin) return json({ error: "Only a superadmin can delete an admin" }, 403);

    const { data: targetProfile } = await supabase
      .from("profiles").select("full_name, email").eq("user_id", target_user_id).maybeSingle();
    const targetName = targetProfile?.full_name || targetProfile?.email || target_user_id.slice(0, 8);

    // Unassign ad accounts instead of deleting them (inventory must stay).
    await supabase.from("ad_accounts").update({ assigned_user_id: null }).eq("assigned_user_id", target_user_id);
    await supabase.from("user_ad_accounts").delete().eq("user_id", target_user_id);

    const childTables = [
      "menu_permissions", "client_banks", "notifications", "push_subscriptions",
      "transactions", "wallets", "top_up_requests", "failed_topups",
      "ad_account_requests", "bm_access_requests", "announcement_dismissals",
      "auto_topup_rules", "client_feedback", "user_roles",
    ];
    for (const t of childTables) {
      const { error } = await supabase.from(t).delete().eq("user_id", target_user_id);
      if (error) console.warn(`delete from ${t} failed:`, error.message);
    }
    await supabase.from("profiles").delete().eq("user_id", target_user_id);

    const { error: authErr } = await supabase.auth.admin.deleteUser(target_user_id);
    if (authErr) {
      console.error("auth delete failed:", authErr.message);
      return json({ error: `Profile removed but auth user delete failed: ${authErr.message}` }, 500);
    }

    const { data: callerProfile } = await supabase
      .from("profiles").select("full_name, email").eq("user_id", callerId).maybeSingle();
    await supabase.from("system_logs").insert({
      user_id: callerId,
      user_name: callerProfile?.full_name || callerProfile?.email || "Admin",
      action: "Client Permanently Deleted",
      details: `${targetName} (${target_user_id}) permanently removed`,
    });

    return json({ success: true });
  } catch (err) {
    console.error("delete-client error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
