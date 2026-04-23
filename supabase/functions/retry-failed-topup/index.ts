import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";
async function metaFetch(url, options = {}) {
  if (!url.startsWith("https://graph.facebook.com/")) {
    const r = await fetch(url, options);
    return { response: r, via: "direct", sourceIp: null };
  }
  const proxySecret = Deno.env.get("META_PROXY_SECRET")?.trim();
  const proxyUrl = (Deno.env.get("META_PROXY_URL") || DEFAULT_META_PROXY_URL).trim();
  if (proxySecret && proxyUrl) {
    try {
      const headers = new Headers(options.headers ?? {});
      const contentType = headers.get("Content-Type") ?? headers.get("content-type") ?? undefined;
      const method = options.method ?? "GET";
      const body = options.body instanceof URLSearchParams ? options.body.toString() : typeof options.body === "string" ? options.body : undefined;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret
        },
        body: JSON.stringify({ url, method, body, contentType }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      const ct = proxyRes.headers.get("content-type") || "";
      const egressIp = proxyRes.headers.get("x-egress-ip") || proxyRes.headers.get("x-forwarded-for") || null;
      if (proxyRes.ok && (ct.includes("application/json") || proxyRes.status === 200)) {
        const text = await proxyRes.text();
        if (!text.trimStart().startsWith("<!") && !text.trimStart().startsWith("<html")) {
          // Detect proxy-level error JSON (no Meta-shaped body)
          try {
            const parsed = JSON.parse(text);
            if (parsed && parsed.error && typeof parsed.error === "string") {
              console.warn("Proxy returned error JSON, falling back to direct:", parsed.error);
            } else {
              return {
                response: new Response(text, { status: proxyRes.status, headers: proxyRes.headers }),
                via: "proxy",
                sourceIp: egressIp,
              };
            }
          } catch {
            return {
              response: new Response(text, { status: proxyRes.status, headers: proxyRes.headers }),
              via: "proxy",
              sourceIp: egressIp,
            };
          }
        } else {
          console.warn("Proxy returned HTML, falling back to direct Meta API call");
        }
      } else {
        console.warn(`Proxy returned status ${proxyRes.status}, falling back to direct call`);
      }
    } catch (proxyErr) {
      console.warn("Proxy fetch failed, falling back to direct Meta API call:", proxyErr);
    }
  }
  const r = await fetch(url, options);
  return { response: r, via: "direct", sourceIp: null };
}
async function decryptToken(stored, secret) {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, [
      "deriveKey"
    ]);
    const key = await crypto.subtle.deriveKey({
      name: "PBKDF2",
      salt: enc.encode("bm-token-enc-v1"),
      iterations: 100000,
      hash: "SHA-256"
    }, keyMaterial, {
      name: "AES-GCM",
      length: 256
    }, false, [
      "decrypt"
    ]);
    const combined = Uint8Array.from(atob(stored.slice(4)), (c)=>c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv
    }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch  {
    return stored;
  }
}
function centsToDollars(cents) {
  return cents / 100;
}
const VERIFY_TOLERANCE = 1.00;
function isCapEffectivelyApplied(verifiedDollars, expectedDollars) {
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
    const { failed_topup_id } = await req.json();
    if (!failed_topup_id) return json({
      error: "failed_topup_id required"
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
    // Fetch ad account with BM
    const { data: account, error: accErr } = await supabase.from("ad_accounts").select("*, business_managers!inner(access_token, bm_id)").eq("id", failedTopup.ad_account_id).single();
    if (accErr || !account) return json({
      error: "Ad account not found"
    }, 404);
    const { data: userProfile } = await supabase.from("profiles").select("full_name").eq("user_id", userId).single();
    const userName = userProfile?.full_name || "Unknown";
    const bm = account.business_managers;
    const bmToken = await decryptToken(bm.access_token, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const newSpendCapDollars = Number(failedTopup.old_spend_cap) + Number(failedTopup.amount);
    const actId = account.account_id.startsWith("act_") ? account.account_id : `act_${account.account_id}`;
    console.log("Retry failed topup", {
      actId,
      newSpendCapDollars,
      failedTopupId: failed_topup_id
    });
    // PRE-CHECK: Verify if the spend cap was already updated (from a previous attempt that falsely reported failure)
    try {
      const { response: preCheckRes } = await metaFetch(`https://graph.facebook.com/v24.0/${actId}?fields=spend_cap&access_token=${encodeURIComponent(bmToken)}`, {
        method: "GET"
      });
      const preCheckData = await preCheckRes.json();
      if (preCheckData?.spend_cap !== undefined) {
        const currentCapDollars = centsToDollars(Number(preCheckData.spend_cap));
        if (isCapEffectivelyApplied(currentCapDollars, newSpendCapDollars)) {
          console.log(`Pre-check: cap already at $${currentCapDollars}. Marking as resolved without re-posting.`);
          const currentAmountSpent = Number(account.amount_spent);
          const remainingAfterTopup = newSpendCapDollars - currentAmountSpent;
          await supabase.from("ad_accounts").update({
            spend_cap: newSpendCapDollars,
            balance_after_topup: remainingAfterTopup
          }).eq("id", failedTopup.ad_account_id);
          await supabase.from("failed_topups").delete().eq("id", failed_topup_id);
          await supabase.from("system_logs").insert({
            user_id: userId,
            user_name: userName,
            action: "Failed Top-Up Auto-Resolved",
            details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${failedTopup.amount} — Cap already correct`
          });
          return json({
            success: true,
            new_spend_cap: newSpendCapDollars,
            auto_resolved: true,
            via: "precheck",
            source_ip: null
          });
        }
      }
    } catch (preErr) {
      console.warn("Pre-check GET failed, proceeding with retry", preErr);
    }
    // Call Meta API
    const { response: metaRes, via: postVia, sourceIp: postIp } = await metaFetch(`https://graph.facebook.com/v24.0/${actId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        spend_cap: String(newSpendCapDollars),
        access_token: bmToken
      })
    });
    let metaData = null;
    try {
      metaData = await metaRes.json();
    } catch  {
      metaData = null;
    }
    if (!metaRes.ok || metaData?.error) {
      const metaErrorMsg = metaData?.error?.message || `Meta HTTP ${metaRes.status}`;
      console.warn("Retry Meta POST failed", {
        actId,
        message: metaErrorMsg,
        via: postVia,
        ip: postIp
      });
      // Update error message + last attempt route info
      await supabase.from("failed_topups").update({
        error_message: metaErrorMsg,
        last_attempt_via: postVia,
        last_attempt_ip: postIp
      }).eq("id", failed_topup_id);
      await supabase.from("system_logs").insert({
        user_id: userId,
        user_name: userName,
        action: "Failed Top-Up Retry Failed",
        details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${failedTopup.amount} — ${metaErrorMsg} — via ${postVia}${postIp ? ` (IP: ${postIp})` : ""}`
      });
      return json({
        error: `Meta API error: ${metaErrorMsg}`,
        via: postVia,
        source_ip: postIp
      }, 400);
    }
    // Verify with GET
    const { response: verifyRes } = await metaFetch(`https://graph.facebook.com/v24.0/${actId}?fields=spend_cap&access_token=${encodeURIComponent(bmToken)}`, {
      method: "GET"
    });
    let verifyData = null;
    try {
      verifyData = await verifyRes.json();
    } catch  {
      verifyData = null;
    }
    if (verifyData?.spend_cap !== undefined) {
      const verifiedDollars = centsToDollars(Number(verifyData.spend_cap));
      if (Math.abs(verifiedDollars - newSpendCapDollars) >= 0.02) {
        const mismatchMsg = `Verification mismatch: expected $${newSpendCapDollars}, got $${verifiedDollars}`;
        await supabase.from("failed_topups").update({
          error_message: mismatchMsg
        }).eq("id", failed_topup_id);
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: "Failed Top-Up Retry Failed",
          details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${failedTopup.amount} — ${mismatchMsg}`
        });
        return json({
          error: mismatchMsg
        }, 400);
      }
    }
    // SUCCESS — update spend cap in DB, remove failed topup
    const currentAmountSpent = Number(account.amount_spent);
    const remainingAfterTopup = newSpendCapDollars - currentAmountSpent;
    await supabase.from("ad_accounts").update({
      spend_cap: newSpendCapDollars,
      balance_after_topup: remainingAfterTopup
    }).eq("id", failedTopup.ad_account_id);
    await supabase.from("failed_topups").delete().eq("id", failed_topup_id);
    // Log API calls
    const bmDbId = account.business_manager_id;
    if (bmDbId) {
      await supabase.from("api_call_logs").insert({
        business_manager_id: bmDbId,
        function_name: "retry-failed-topup",
        call_count: 2
      });
    }
    await supabase.from("system_logs").insert({
      user_id: userId,
      user_name: userName,
      action: "Failed Top-Up Retried",
      details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${failedTopup.amount} — New cap: $${newSpendCapDollars}`
    });
    console.log("Retry SUCCESS", {
      actId,
      newSpendCapDollars
    });
    return json({
      success: true,
      new_spend_cap: newSpendCapDollars
    });
  } catch (err) {
    console.error("retry-failed-topup error:", err);
    return json({
      error: err instanceof Error ? err.message : "Unknown error"
    }, 500);
  }
});
