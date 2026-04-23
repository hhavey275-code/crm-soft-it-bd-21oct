import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";
// Track route + IP used for the most recent Meta API call (per request)
let lastMetaVia = "direct";
let lastMetaIp = null;
async function metaFetch(url, options = {}) {
  if (!url.startsWith("https://graph.facebook.com/")) return fetch(url, options);
  const proxySecret = Deno.env.get("META_PROXY_SECRET")?.trim();
  const proxyUrl = (Deno.env.get("META_PROXY_URL") || DEFAULT_META_PROXY_URL).trim();
  if (proxySecret && proxyUrl) {
    try {
      const headers = new Headers(options.headers ?? {});
      const contentType = headers.get("Content-Type") ?? headers.get("content-type") ?? undefined;
      const method = options.method ?? "GET";
      const body = options.body instanceof URLSearchParams ? options.body.toString() : typeof options.body === "string" ? options.body : undefined;
      // 8s timeout so a hung proxy can't block the function
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret
        },
        body: JSON.stringify({ url, method, body, contentType }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      // Capture proxy IP from response header
      try {
        const proxyIp = proxyRes.headers.get("x-egress-ip") || proxyRes.headers.get("x-proxy-ip");
        if (proxyIp) lastMetaIp = proxyIp;
      } catch {}
      const text = await proxyRes.text();
      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");
      // Detect proxy-level errors. Proxy errors look like {"error":"string"};
      // Meta errors look like {"error":{"message":...,"code":...}}.
      let isProxyOwnError = false;
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.error === "string") {
            isProxyOwnError = true;
            console.warn("Proxy returned own error, falling back to direct Meta:", parsed.error);
          }
        } catch {}
      }
      // Fallback on ANY non-2xx, HTML body, or proxy-shape error
      const shouldFallback = looksLikeHtml || isProxyOwnError || proxyRes.status < 200 || proxyRes.status >= 300;
      if (!shouldFallback) {
        lastMetaVia = "proxy";
        return new Response(text, { status: proxyRes.status, headers: proxyRes.headers });
      }
      console.warn(`Proxy unhealthy (status=${proxyRes.status}, html=${looksLikeHtml}, proxyErr=${isProxyOwnError}) — direct fallback`);
    } catch (proxyErr) {
      console.warn("Proxy failed, falling back to direct call:", proxyErr?.message || proxyErr);
    }
  }
  lastMetaVia = "direct";
  lastMetaIp = null;
  return fetch(url, options);
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
const delay = (ms)=>new Promise((r)=>setTimeout(r, ms));
// Tolerance for "verified == expected" comparisons. Meta sometimes stores
// caps with small currency-conversion / rounding offsets (often ±1¢).
// We accept anything within $1 OR any value >= expected as success.
const VERIFY_TOLERANCE = 1.00;
function isCapEffectivelyApplied(verifiedDollars, expectedDollars) {
  if (!Number.isFinite(verifiedDollars)) return false;
  if (verifiedDollars >= expectedDollars) return true; // cap >= what we asked for
  return Math.abs(verifiedDollars - expectedDollars) < VERIFY_TOLERANCE;
}
// Verify GET with one automatic retry after 3s — handles proxy/stale data.
async function verifySpendCap(actId, bmToken) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await delay(3000);
    try {
      const res = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=spend_cap&access_token=${encodeURIComponent(bmToken)}`, {
        method: "GET"
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok && !data?.error && data?.spend_cap !== undefined) {
        return { ok: true, dollars: centsToDollars(Number(data.spend_cap)), error: null };
      }
      if (attempt === 1) {
        return { ok: false, dollars: null, error: data?.error?.message || `Verify HTTP ${res.status}` };
      }
    } catch (err) {
      if (attempt === 1) {
        return { ok: false, dollars: null, error: err instanceof Error ? err.message : "verify network error" };
      }
    }
  }
  return { ok: false, dollars: null, error: "verify exhausted" };
}
function isMetaRateLimited(status, data) {
  const message = String(data?.error?.message ?? "").toLowerCase();
  return status === 429 || data?.error?.code === 17 || data?.error?.code === 32 || data?.error?.code === 4 || message.includes("user request limit reached") || message.includes("request limit");
}
function getRetryDelayMs(attempt, retryAfterHeader) {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 120000);
  }
  const backoffMs = [
    5000,
    15000,
    30000,
    60000
  ];
  return backoffMs[Math.min(attempt, backoffMs.length - 1)];
}
async function metaFetchWithRetry(url, options, maxRetries = 3) {
  // SAFETY: POST is NOT idempotent. If a previous POST already updated the
  // spend cap but the response was slow, retrying will double-apply the
  // change. Force maxRetries=0 for any non-GET request.
  const method = (options?.method || "GET").toUpperCase();
  if (method !== "GET") maxRetries = 0;
  for(let attempt = 0; attempt <= maxRetries; attempt++){
    const res = await metaFetch(url, options);
    let data = null;
    try {
      data = await res.json();
    } catch  {
      data = null;
    }
    const rateLimited = isMetaRateLimited(res.status, data);
    if (rateLimited && attempt < maxRetries) {
      const waitMs = getRetryDelayMs(attempt, res.headers.get("retry-after"));
      console.log(`Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), waiting ${waitMs}ms...`);
      await delay(waitMs);
      continue;
    }
    if (rateLimited) {
      throw new Error("META_RATE_LIMIT_RETRY_EXHAUSTED");
    }
    return {
      res,
      data
    };
  }
  throw new Error("META_FETCH_RETRY_EXHAUSTED");
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
    // --- Auth ---
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
      error: "Unauthorized - invalid token"
    }, 401);
    const userId = claimsData.claims.sub;
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // --- Role check ---
    const { data: userRole } = await supabase.from("user_roles").select("role").eq("user_id", userId).single();
    const isAdmin = userRole?.role === "admin" || userRole?.role === "superadmin";
    // --- Parse body ---
    const { ad_account_id, amount, deduct_wallet, target_user_id } = await req.json();
    if (!ad_account_id || !amount) return json({
      error: "ad_account_id and amount required"
    }, 400);
    // --- License / System Limit Check (Tenant mode) ---
    const { data: licenseSettings } = await supabase.from("site_settings").select("key, value").in("key", [
      "master_url",
      "tenant_api_key",
      "license_status",
      "license_system_limit",
      "license_total_used",
      "license_subscription_type"
    ]);
    const licenseMap = {};
    if (licenseSettings) {
      for (const s of licenseSettings)licenseMap[s.key] = s.value;
    }
    const isTenantMode = !!licenseMap["master_url"] && !!licenseMap["tenant_api_key"];
    if (isTenantMode) {
      // Check if tenant is frozen
      if (licenseMap["license_status"] === "frozen") {
        return json({
          error: "System license is frozen. Please contact the master admin."
        }, 403);
      }
      // Check system limit for Type B tenants
      if (licenseMap["license_subscription_type"] === "subscription_with_limit" && licenseMap["license_system_limit"]) {
        const systemLimit = Number(licenseMap["license_system_limit"]);
        const totalUsed = Number(licenseMap["license_total_used"] || 0);
        if (totalUsed + amount > systemLimit) {
          const remaining = systemLimit - totalUsed;
          return json({
            error: `System limit reached. Remaining: $${remaining.toFixed(2)}. Contact master admin to increase limit.`
          }, 403);
        }
      }
    }
    // --- Non-admin checks ---
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
    // --- Fetch ad account with BM ---
    const { data: account, error: accErr } = await supabase.from("ad_accounts").select("*, business_managers!inner(access_token, bm_id)").eq("id", ad_account_id).single();
    if (accErr || !account) return json({
      error: "Ad account not found"
    }, 404);
    // --- Get user name for logging ---
    const { data: userProfile } = await supabase.from("profiles").select("full_name").eq("user_id", userId).single();
    const userName = userProfile?.full_name || "Unknown";
    // --- Determine wallet user ---
    const shouldDeductWallet = !!deduct_wallet;
    const walletUserId = target_user_id || userId;
    // ============================================
    // STEP 1: Deduct wallet FIRST (before Meta API)
    // ============================================
    let newBalance = null;
    let walletId = null;
    if (shouldDeductWallet) {
      const { data: wallet, error: walletErr } = await supabase.from("wallets").select("id, balance").eq("user_id", walletUserId).single();
      if (walletErr || !wallet) return json({
        error: "Wallet not found for user"
      }, 404);
      // Admin/superadmin can top up even with insufficient balance (go negative)
      if (!isAdmin) {
        const { data: prof } = await supabase.from("profiles").select("due_limit").eq("user_id", walletUserId).single();
        const dueLimit = Number(prof?.due_limit ?? 0);
        if (Number(wallet.balance) + dueLimit < amount) return json({
          error: "Insufficient wallet balance"
        }, 400);
      }
      newBalance = Number(wallet.balance) - amount;
      walletId = wallet.id;
      // Deduct wallet
      await supabase.from("wallets").update({
        balance: newBalance
      }).eq("id", wallet.id);
      // Create transaction record
      const cleanAccountId = account.account_id.replace(/^act_/, '');
      await supabase.from("transactions").insert({
        user_id: walletUserId,
        amount: -amount,
        balance_after: newBalance,
        type: "ad_topup",
        description: `${account.account_name}\n${cleanAccountId}`,
        reference_id: ad_account_id,
        processed_by: isAdmin ? `admin:${userId}` : `client:${walletUserId}`
      });
    }
    // ============================================
    // STEP 2: Call Meta API
    // ============================================
    const bm = account.business_managers;
    const bmToken = await decryptToken(bm.access_token, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const oldSpendCapDollars = Number(account.spend_cap);
    const newSpendCapDollars = oldSpendCapDollars + amount;
    const actId = account.account_id.startsWith("act_") ? account.account_id : `act_${account.account_id}`;
    console.log("Spend cap update attempt", {
      actId,
      bmId: bm.bm_id,
      oldSpendCapDollars,
      amountDollars: amount,
      newSpendCapDollars,
      walletDeducted: shouldDeductWallet
    });
    try {
      const { res: metaRes, data: metaData } = await metaFetchWithRetry(`https://graph.facebook.com/v23.0/${actId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          spend_cap: String(newSpendCapDollars),
          access_token: bmToken
        })
      });
      if (!metaRes.ok || metaData?.error) {
        const metaErrorMsg = metaData?.error?.message || `Meta HTTP ${metaRes.status}`;
        const rateLimited = isMetaRateLimited(metaRes.status, metaData);
        console.warn("Meta POST failed", {
          actId,
          status: metaRes.status,
          message: metaErrorMsg
        });
        // CRITICAL: POST may have succeeded despite error response.
        // Do a GET to check if spend cap was actually updated.
        let actuallySucceeded = false;
        try {
          const verifyResult = await verifySpendCap(actId, bmToken);
          if (verifyResult.ok && isCapEffectivelyApplied(verifyResult.dollars, newSpendCapDollars)) {
            actuallySucceeded = true;
            console.log(`POST returned error but GET confirms cap at $${verifyResult.dollars} (expected $${newSpendCapDollars}). Treating as success.`);
          }
        } catch (verifyErr) {
          console.warn("Post-failure verification GET also failed", verifyErr);
        }
        if (actuallySucceeded) {
          // Spend cap was actually updated — proceed as success
          const currentAmountSpent = Number(account.amount_spent);
          const remainingAfterTopup = newSpendCapDollars - currentAmountSpent;
          await supabase.from("ad_accounts").update({
            spend_cap: newSpendCapDollars,
            balance_after_topup: remainingAfterTopup
          }).eq("id", ad_account_id);
          const bmDbId = account.business_manager_id;
          if (bmDbId) {
            await supabase.from("api_call_logs").insert({
              business_manager_id: bmDbId,
              function_name: "spend-cap-update",
              call_count: 2
            });
          }
          await supabase.from("system_logs").insert({
            user_id: userId,
            user_name: userName,
            action: "Spend Cap Updated",
            details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars} (recovered from POST error) [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`
          });
          return json({
            success: true,
            old_spend_cap: oldSpendCapDollars,
            new_spend_cap: newSpendCapDollars
          });
        }
        // Actually failed — insert into failed_topups
        const { data: failedRecord } = await supabase.from("failed_topups").insert({
          user_id: walletUserId,
          ad_account_id,
          amount,
          old_spend_cap: oldSpendCapDollars,
          error_message: metaErrorMsg,
          status: "pending"
        }).select("id").single();
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: "Top-Up Failed",
          details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${amount} — ${metaErrorMsg} [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`
        });
        const errorCode = rateLimited ? "META_RATE_LIMIT" : "META_API_ERROR";
        return json({
          error: rateLimited ? "Meta API is busy (rate limit reached). Amount deducted from wallet. You can retry from Failed Top-Ups." : `Meta API error: ${metaErrorMsg}. Amount deducted from wallet. You can retry from Failed Top-Ups.`,
          code: errorCode,
          failed_topup_id: failedRecord?.id,
          wallet_charged: shouldDeductWallet
        }, rateLimited ? 429 : 400);
      }
      // Verify with GET
      const verifyResult = await verifySpendCap(actId, bmToken);
      if (!verifyResult.ok) {
        const verifyErrorMsg = verifyResult.error || "Meta verify failed";
        console.warn("Meta verification failed (after retry)", { actId, message: verifyErrorMsg });
        // POST may have succeeded — flag clearly in error_message so admin
        // can confirm in Meta before retrying (which would double-apply).
        const safeMsg = `Verification failed: ${verifyErrorMsg}. POST may have succeeded — please verify cap in Meta before retry.`;
        const { data: failedRecord } = await supabase.from("failed_topups").insert({
          user_id: walletUserId,
          ad_account_id: ad_account_id,
          amount: amount,
          old_spend_cap: oldSpendCapDollars,
          error_message: safeMsg,
          status: "pending"
        }).select("id").single();
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: "Top-Up Failed",
          details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${amount} — ${safeMsg} [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`
        });
        return json({
          error: `${safeMsg} Amount deducted from wallet.`,
          failed_topup_id: failedRecord?.id,
          wallet_charged: shouldDeductWallet
        }, 400);
      }
      const verifiedDollars = verifyResult.dollars;
      if (isCapEffectivelyApplied(verifiedDollars, newSpendCapDollars)) {
        console.log(`Meta verified: $${verifiedDollars} (expected $${newSpendCapDollars})`);
      } else {
        const mismatchMsg = `Verification mismatch: expected $${newSpendCapDollars}, got $${verifiedDollars}`;
        console.warn(mismatchMsg);
        const { data: failedRecord } = await supabase.from("failed_topups").insert({
          user_id: walletUserId,
          ad_account_id: ad_account_id,
          amount: amount,
          old_spend_cap: oldSpendCapDollars,
          error_message: mismatchMsg,
          status: "pending"
        }).select("id").single();
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: "Top-Up Failed",
          details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${amount} — ${mismatchMsg} [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`
        });
        return json({
          error: `${mismatchMsg}. Amount deducted from wallet. You can retry from Failed Top-Ups.`,
          failed_topup_id: failedRecord?.id,
          wallet_charged: shouldDeductWallet
        }, 400);
      }
    } catch (err) {
      const metaErrorMsg = err instanceof Error ? err.message : "Network error";
      console.warn("Meta network error", metaErrorMsg);
      // POST may have succeeded before the exception (timeout after Meta
      // accepted the change). Try a verification GET first.
      try {
        const verifyResult = await verifySpendCap(actId, bmToken);
        if (verifyResult.ok && isCapEffectivelyApplied(verifyResult.dollars, newSpendCapDollars)) {
          console.log(`Network error but GET confirms cap at $${verifyResult.dollars}. Treating as success.`);
          const currentAmountSpent = Number(account.amount_spent);
          const remainingAfterTopup = newSpendCapDollars - currentAmountSpent;
          await supabase.from("ad_accounts").update({
            spend_cap: newSpendCapDollars,
            balance_after_topup: remainingAfterTopup
          }).eq("id", ad_account_id);
          await supabase.from("system_logs").insert({
            user_id: userId,
            user_name: userName,
            action: "Spend Cap Updated",
            details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars} (recovered from network error: ${metaErrorMsg}) [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`
          });
          return json({
            success: true,
            old_spend_cap: oldSpendCapDollars,
            new_spend_cap: newSpendCapDollars
          });
        }
      } catch (verifyErr) {
        console.warn("Recovery verify after network error also failed", verifyErr);
      }
      const safeMsg = `${metaErrorMsg}. POST may have succeeded — please verify cap in Meta before retry.`;
      // Insert into failed_topups
      const { data: failedRecord } = await supabase.from("failed_topups").insert({
        user_id: walletUserId,
        ad_account_id: ad_account_id,
        amount: amount,
        old_spend_cap: oldSpendCapDollars,
        error_message: safeMsg,
        status: "pending"
      }).select("id").single();
      await supabase.from("system_logs").insert({
        user_id: userId,
        user_name: userName,
        action: "Top-Up Failed",
        details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${amount} — ${metaErrorMsg} [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`
      });
      return json({
        error: `Meta API error: ${metaErrorMsg}. Amount deducted from wallet. You can retry from Failed Top-Ups.`,
        failed_topup_id: failedRecord?.id,
        wallet_charged: shouldDeductWallet
      }, 500);
    }
    // ============================================
    // STEP 3: Meta succeeded — log API calls
    // ============================================
    const bmId = bm.bm_id;
    const bmDbId = account.business_manager_id;
    if (bmDbId) {
      await supabase.from("api_call_logs").insert({
        business_manager_id: bmDbId,
        function_name: "spend-cap-update",
        call_count: 2
      });
    }
    // ============================================
    // STEP 4: Update DB spend cap
    // ============================================
    const currentAmountSpent = Number(account.amount_spent);
    const remainingAfterTopup = newSpendCapDollars - currentAmountSpent;
    await supabase.from("ad_accounts").update({
      spend_cap: newSpendCapDollars,
      balance_after_topup: remainingAfterTopup
    }).eq("id", ad_account_id);
    // Log success
    await supabase.from("system_logs").insert({
      user_id: userId,
      user_name: userName,
      action: "Spend Cap Updated",
      details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars} [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`
    });
    // ============================================
    // STEP 4.5: Post-update health check — diagnostic
    // ============================================
    let billingWarning = null;
    try {
      const healthRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=account_status,disable_reason,funding_source_details&access_token=${encodeURIComponent(bmToken)}`, {
        method: "GET"
      });
      const healthData = await healthRes.json();
      const metaStatus = healthData?.account_status ?? null;
      const disableReason = healthData?.disable_reason ?? null;
      // Log event to meta_account_events
      await supabase.from("meta_account_events").insert({
        ad_account_id,
        ad_account_name: account.account_name,
        account_meta_id: actId,
        bm_id: bmDbId || null,
        event_type: "spend_cap_update",
        actor: isAdmin ? `admin:${userId}` : `client:${userId}`,
        request_summary: {
          old_cap: oldSpendCapDollars,
          new_cap: newSpendCapDollars,
          amount
        },
        response_summary: {
          success: true,
          account_status: metaStatus,
          disable_reason: disableReason,
          funding_source: healthData?.funding_source_details?.display_string || null
        },
        account_status: metaStatus,
        disable_reason: disableReason
      });
      if (metaStatus && metaStatus !== 1) {
        billingWarning = {
          account_status: metaStatus,
          disable_reason: disableReason,
          message: `Account status is ${metaStatus} after top-up. Disable reason: ${disableReason || "unknown"}`
        };
        console.warn("Post-topup health warning:", billingWarning);
      }
    } catch (healthErr) {
      console.warn("Post-topup health check failed:", healthErr);
    }
    // ============================================
    // STEP 5: Report usage to master (Tenant mode)
    // ============================================
    if (isTenantMode) {
      try {
        const reportRes = await fetch(`${licenseMap["master_url"]}/functions/v1/tenant-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tenant-Key": licenseMap["tenant_api_key"]
          },
          body: JSON.stringify({
            action: "report-usage",
            amount
          })
        });
        const reportData = await reportRes.json();
        // Update local cache
        if (reportData.total_used !== undefined) {
          await supabase.from("site_settings").update({
            value: String(reportData.total_used)
          }).eq("key", "license_total_used");
        }
      } catch (reportErr) {
        console.warn("Failed to report usage to master:", reportErr);
      }
    }
    console.log("Spend cap update SUCCESS", {
      actId,
      oldSpendCapDollars,
      newSpendCapDollars
    });
    return json({
      success: true,
      old_spend_cap: oldSpendCapDollars,
      new_spend_cap: newSpendCapDollars,
      billing_warning: billingWarning
    });
  } catch (err) {
    console.error("spend-cap-update error:", err);
    return json({
      error: err instanceof Error ? err.message : "Unknown error"
    }, 500);
  }
});
