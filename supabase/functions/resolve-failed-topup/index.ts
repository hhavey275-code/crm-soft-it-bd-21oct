import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const json = (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({
      error: "Unauthorized"
    }, 401);
    const token = authHeader.replace("Bearer ", "");
    const supabaseUser = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({
      error: "Unauthorized"
    }, 401);
    const userId = claimsData.claims.sub;
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", userId).single();
    const isAdmin = userRole?.role === "admin" || userRole?.role === "superadmin";
    const { failed_topup_id, action } = await req.json();
    if (!failed_topup_id) return json({
      error: "failed_topup_id required"
    }, 400);
    if (action !== "refund") return json({
      error: "action must be 'refund'"
    }, 400);
    // Fetch the failed topup record
    const { data: failedTopup, error: ftErr } = await supabase.from("failed_topups").select("*").eq("id", failed_topup_id).eq("status", "pending").single();
    if (ftErr || !failedTopup) return json({
      error: "Failed top-up not found or already resolved"
    }, 404);
    // Auth check: admin or owner
    if (!isAdmin && failedTopup.user_id !== userId) return json({
      error: "Forbidden"
    }, 403);
    const { data: userProfile } = await supabase.from("profiles").select("full_name").eq("user_id", userId).single();
    const userName = userProfile?.full_name || "Unknown";
    // Fetch ad account name for logging
    const { data: account } = await supabase.from("ad_accounts").select("account_name, account_id").eq("id", failedTopup.ad_account_id).single();
    const accountName = account?.account_name || "Unknown";
    const accountId = account?.account_id?.replace(/^act_/, '') || "";
    // Refund wallet
    const { data: wallet, error: walletErr } = await supabase.from("wallets").select("id, balance").eq("user_id", failedTopup.user_id).single();
    if (walletErr || !wallet) return json({
      error: "Wallet not found"
    }, 404);
    const newBalance = Number(wallet.balance) + Number(failedTopup.amount);
    await supabase.from("wallets").update({
      balance: newBalance
    }).eq("id", wallet.id);
    // Create refund transaction
    await supabase.from("transactions").insert({
      user_id: failedTopup.user_id,
      amount: Number(failedTopup.amount),
      balance_after: newBalance,
      type: "refund",
      description: `Refund: Failed top-up\n${accountName}\n${accountId}`,
      reference_id: failedTopup.ad_account_id,
      processed_by: isAdmin ? `admin:${userId}` : `client:${failedTopup.user_id}`
    });
    // Delete the failed topup record
    await supabase.from("failed_topups").delete().eq("id", failed_topup_id);
    // Log to system_logs
    await supabase.from("system_logs").insert({
      user_id: userId,
      user_name: userName,
      action: "Failed Top-Up Refunded",
      details: `${accountName} (${accountId}) — $${failedTopup.amount} refunded to wallet`
    });
    // Restore tenant system limit if in tenant mode
    try {
      const { data: tenantSettings } = await supabase.from("site_settings").select("key, value").in("key", [
        "is_tenant",
        "master_url",
        "tenant_api_key"
      ]);
      const sMap = {};
      (tenantSettings || []).forEach((s)=>{
        sMap[s.key] = s.value;
      });
      if (sMap.is_tenant === "true" && sMap.master_url && sMap.tenant_api_key) {
        const refundRes = await fetch(`${sMap.master_url}/functions/v1/tenant-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tenant-Key": sMap.tenant_api_key
          },
          body: JSON.stringify({
            action: "refund-usage",
            amount: Number(failedTopup.amount),
            idempotency_key: `refund:${failed_topup_id}`,
            source: "resolve-failed-topup",
            meta: { failed_topup_id, ad_account_id: failedTopup.ad_account_id, user_id: failedTopup.user_id }
          })
        });
        const refundData = await refundRes.json();
        if (refundData.success) {
          // Update local cache
          const { data: existing } = await supabase.from("site_settings").select("id").eq("key", "license_total_used").single();
          const newUsed = String(refundData.total_used ?? 0);
          if (existing) {
            await supabase.from("site_settings").update({
              value: newUsed
            }).eq("key", "license_total_used");
          }
        }
        console.log("Tenant usage refunded:", refundData);
      }
    } catch (tenantErr) {
      console.error("Tenant refund-usage failed:", tenantErr);
    }
    console.log("Failed topup refunded", {
      failedTopupId: failed_topup_id,
      amount: failedTopup.amount
    });
    return json({
      success: true,
      refunded_amount: Number(failedTopup.amount),
      new_balance: newBalance
    });
  } catch (err) {
    console.error("resolve-failed-topup error:", err);
    return json({
      error: err instanceof Error ? err.message : "Unknown error"
    }, 500);
  }
});
