import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
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
    // Auth
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
    // Role check
    const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", userId).single();
    const isAdmin = userRole?.role === "admin" || userRole?.role === "superadmin";
    // Parse body
    const { ad_account_id, amount, deduct_wallet, target_user_id } = await req.json();
    if (!ad_account_id || !amount) return json({
      error: "ad_account_id and amount required"
    }, 400);

    // Idempotency guard: block duplicate (user, account, amount) within 60s
    const dedupeUserId = target_user_id || userId;
    try {
      const since = new Date(Date.now() - 60_000).toISOString();
      const { data: recentDup } = await supabase
        .from("transactions")
        .select("id")
        .eq("user_id", dedupeUserId)
        .eq("type", "ad_topup")
        .eq("reference_id", ad_account_id)
        .eq("amount", -Number(amount))
        .gte("created_at", since)
        .limit(1);
      if (recentDup && recentDup.length > 0) {
        return json({
          error: "Duplicate top-up detected (same amount submitted within the last 60 seconds).",
          code: "DUPLICATE_TOPUP",
        }, 409);
      }
    } catch (e) {
      console.warn("Dedupe check failed (non-blocking):", e);
    }

    // Non-admin checks
    if (!isAdmin) {
      const { data: profile } = await supabase.from("profiles").select("status").eq("user_id", userId).single();
      if (profile?.status === "inactive") return json({
        error: "Your account has been frozen."
      }, 403);
      const { data: assignment } = await supabase.from("user_ad_accounts").select("id").eq("user_id", userId).eq("ad_account_id", ad_account_id).single();
      if (!assignment) return json({
        error: "Forbidden"
      }, 403);
    }
    // Fetch ad account
    const { data: account, error: accErr } = await supabase.from("ad_accounts").select("*, business_managers(bm_id)").eq("id", ad_account_id).eq("platform", "tiktok").single();
    if (accErr || !account) return json({
      error: "TikTok ad account not found"
    }, 404);
    const { data: userProfile } = await supabase.from("profiles").select("full_name").eq("user_id", userId).single();
    const userName = userProfile?.full_name || "Unknown";
    const shouldDeductWallet = !!deduct_wallet;
    const walletUserId = target_user_id || userId;
    // STEP 1: Wallet deduction
    let newBalance = null;
    if (shouldDeductWallet) {
      // Atomic deduction: the RPC locks the wallet, reconciles it against its
      // own ledger, deducts and writes the transaction in ONE database
      // transaction. Never read-then-write a balance here.
      const { data: prof } = await supabase.from("profiles").select("due_limit").eq("user_id", walletUserId).single();
      const dueLimit = Number(prof?.due_limit ?? 0);
      const { data: dedRes, error: dedErr } = await supabase.rpc("deduct_wallet_for_topup_v2", {
        p_user_id: walletUserId,
        p_amount: amount,
        p_ad_account_id: ad_account_id,
        p_description: `${account.account_name}\n${account.account_id} (TikTok)`,
        p_processed_by: isAdmin ? `admin:${userId}` : `client:${walletUserId}`,
        p_wallet_kind: "primary",
        p_allow_negative: false,
        p_due_limit: dueLimit,
      });
      if (dedErr) return json({ error: dedErr.message || "Wallet deduction failed" }, 500);
      if (!dedRes?.ok) {
        return json({
          error: dedRes?.error === "insufficient_balance" ? "Insufficient wallet balance" : (dedRes?.error || "Wallet deduction failed"),
        }, 400);
      }
      newBalance = Number(dedRes.balance_after);
    }

    const oldSpendCap = Number(account.spend_cap);
    const newSpendCap = oldSpendCap + amount;
    if (isAdmin) {
      // Admin flow: update spend cap in DB immediately
      const currentAmountSpent = Number(account.amount_spent);
      const remainingAfterTopup = newSpendCap - currentAmountSpent;
      await supabase.from("ad_accounts").update({
        spend_cap: newSpendCap,
        balance_after_topup: remainingAfterTopup
      }).eq("id", ad_account_id);
      await supabase.from("system_logs").insert({
        user_id: userId,
        user_name: userName,
        action: "TikTok Spend Cap Updated",
        details: `${account.account_name} (${account.account_id}) — $${oldSpendCap} → $${newSpendCap}`
      });
      return json({
        success: true,
        old_spend_cap: oldSpendCap,
        new_spend_cap: newSpendCap
      });
    } else {
      // Client flow: DON'T update spend cap yet — client must verify on TikTok
      // Build billing redirect URL
      const bmId = account.business_managers?.bm_id;
      const billingUrl = bmId ? `https://business.tiktok.com/manage/payment/v2?org_id=${bmId}&aadvid=${account.account_id}` : `https://ads.tiktok.com/i18n/account/payment?aadvid=${account.account_id}`;
      await supabase.from("system_logs").insert({
        user_id: userId,
        user_name: userName,
        action: "TikTok Client Top-Up (Pending Verify)",
        details: `${account.account_name} (${account.account_id}) — Wallet deducted $${amount}, old cap $${oldSpendCap}, expected new cap $${newSpendCap}`
      });
      return json({
        success: true,
        pending_verify: true,
        old_spend_cap: oldSpendCap,
        expected_new_cap: newSpendCap,
        amount,
        billing_url: billingUrl,
        ad_account_id,
        account_id: account.account_id
      });
    }
  } catch (err) {
    console.error("tiktok-topup error:", err);
    return json({
      error: err instanceof Error ? err.message : "Unknown error"
    }, 500);
  }
});
