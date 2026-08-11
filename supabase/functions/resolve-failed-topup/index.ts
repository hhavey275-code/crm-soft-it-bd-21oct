import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { metaFetch } from "../_shared/meta-fetch.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
async function decryptToken(stored: string, secret: string) {
  if (!stored?.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({
      name: "PBKDF2", salt: enc.encode("bm-token-enc-v1"), iterations: 100000, hash: "SHA-256"
    }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
    return new TextDecoder().decode(decrypted);
  } catch {
    return stored;
  }
}
const VERIFY_TOLERANCE = 1.00;
function isCapEffectivelyApplied(verifiedDollars: number, expectedDollars: number) {
  if (!Number.isFinite(verifiedDollars)) return false;
  if (verifiedDollars >= expectedDollars) return true;
  return Math.abs(verifiedDollars - expectedDollars) < VERIFY_TOLERANCE;
}
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
    const { failed_topup_id, action, force } = await req.json();
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
    // Fetch ad account (with BM token) for logging + live verification
    const { data: account } = await supabase.from("ad_accounts").select("account_name, account_id, amount_spent, business_managers(access_token, bm_id)").eq("id", failedTopup.ad_account_id).single();
    const accountName = account?.account_name || "Unknown";
    const accountId = account?.account_id?.replace(/^act_/, '') || "";
    // ============================================================
    // GUARD: the top-up may have actually landed on Meta even though it
    // was recorded as failed. Refunding in that case gives the client the
    // money back AND the spend cap — double credit. Verify live first.
    // ============================================================
    const bm = (account as any)?.business_managers;
    if (!force && bm?.access_token) {
      const actId = account!.account_id.startsWith("act_") ? account!.account_id : `act_${account!.account_id}`;
      const bmToken = await decryptToken(bm.access_token, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
      let liveCap: number | null = null;
      let liveSpent: number | null = null;
      try {
        const res = await metaFetch(`https://graph.facebook.com/v24.0/${actId}?fields=spend_cap,amount_spent&access_token=${encodeURIComponent(bmToken)}`, { method: "GET", allowDirectFallback: true });
        const d = await res.json();
        if (d?.spend_cap !== undefined) liveCap = Number(d.spend_cap) / 100;
        if (d?.amount_spent !== undefined) liveSpent = Number(d.amount_spent) / 100;
      } catch (e) {
        console.warn("Refund pre-check GET failed", e);
      }
      if (liveCap === null) {
        return json({
          error: "Cannot read live spend cap from Meta right now. Refund blocked to avoid double-crediting — check the account in Ads Manager and try again.",
          code: "META_UNREADABLE"
        }, 400);
      }
      const expected = Number(failedTopup.old_spend_cap) + Number(failedTopup.amount);
      if (isCapEffectivelyApplied(liveCap, expected)) {
        // Top-up actually succeeded — resolve without refunding.
        const spent = liveSpent ?? Number(account!.amount_spent ?? 0);
        await supabase.from("ad_accounts").update({
          spend_cap: liveCap,
          amount_spent: spent,
          balance_after_topup: liveCap - spent
        }).eq("id", failedTopup.ad_account_id);
        await supabase.from("failed_topups").delete().eq("id", failed_topup_id);
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: "Failed Top-Up Auto-Resolved (no refund)",
          details: `${accountName} (${accountId}) — $${failedTopup.amount} — spend cap already applied on Meta ($${liveCap}), refund skipped`
        });
        return json({
          success: true,
          auto_resolved: true,
          refunded_amount: 0,
          new_spend_cap: liveCap,
          message: "Top-up had actually succeeded on Meta — entry cleared, no refund issued."
        });
      }
    }
    // Atomic refund: ledger row + wallet balance + clearing the failed record
    // all happen inside ONE database transaction, so a "refunded" toast can
    // never appear without the money actually landing in the wallet.
    const { data: refundRes, error: refundErr } = await supabase.rpc("refund_failed_topup", {
      p_failed_topup_id: failed_topup_id,
      p_processed_by: isAdmin ? `admin:${userId}` : `client:${failedTopup.user_id}`
    });
    if (refundErr) return json({ error: refundErr.message || "Refund failed" }, 500);
    if (!refundRes || (refundRes as any).success === false) {
      return json({ error: (refundRes as any)?.error || "Refund failed" }, 400);
    }
    const refundWalletKind = (refundRes as any).wallet_kind;
    const newBalance = Number((refundRes as any).new_balance);

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
        const tenantRefundRes = await fetch(`${sMap.master_url}/functions/v1/tenant-webhook`, {
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
        const refundData = await tenantRefundRes.json();
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
