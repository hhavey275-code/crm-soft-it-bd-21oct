import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  metaFetch,
  resetMetaCounters,
  metaCallSummary as sharedMetaCallSummary,
  getLastMetaIp,
  getMetaProxyCount,
  getMetaDirectCount,
  getMetaProxyFailReasons,
} from "../_shared/meta-fetch.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
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

// Idempotent usage report to master CRM. The same idempotency_key (typically
// per ad_account+amount+timestamp tuple) MUST be used for every retry of the
// same logical top-up — including network-error / POST-error recovery paths —
// so master never double-counts. Master dedupes by (tenant_id, idempotency_key).
async function reportUsageToMaster(licenseMap: Record<string, string>, amount: number, idempotencyKey: string, supabase: any, source?: string, meta?: Record<string, unknown>) {
  // Read local total_used BEFORE the call so we can record drift
  let localBefore: number | null = null;
  try {
    const { data: beforeRow } = await supabase.from("site_settings").select("value").eq("key", "license_total_used").maybeSingle();
    if (beforeRow?.value !== undefined && beforeRow?.value !== null) localBefore = Number(beforeRow.value);
  } catch {}

  const payload = {
    action: "report-usage",
    amount,
    idempotency_key: idempotencyKey,
    source: source ?? "spend-cap-update",
    meta: meta ?? null,
  };

  let responseStatus: number | null = null;
  let responseBody: any = null;
  let errorMessage: string | null = null;
  let localAfter: number | null = localBefore;

  try {
    const reportRes = await fetch(`${licenseMap["master_url"]}/functions/v1/tenant-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Key": licenseMap["tenant_api_key"],
      },
      body: JSON.stringify(payload),
    });
    responseStatus = reportRes.status;
    responseBody = await reportRes.json().catch(() => ({}));
    if (responseBody?.total_used !== undefined) {
      localAfter = Number(responseBody.total_used);
      await supabase.from("site_settings").update({
        value: String(responseBody.total_used),
      }).eq("key", "license_total_used");
    }
  } catch (reportErr) {
    errorMessage = reportErr instanceof Error ? reportErr.message : String(reportErr);
    console.warn("Failed to report usage to master:", reportErr);
  }

  // Audit log — fire-and-forget, never block the caller
  try {
    const m: any = meta ?? {};
    await supabase.from("tenant_usage_audit").insert({
      source: source ?? "spend-cap-update",
      action: "report-usage",
      amount,
      idempotency_key: idempotencyKey,
      ad_account_id: m.ad_account_id ?? null,
      wallet_txn_id: m.wallet_txn_id ?? null,
      failed_topup_id: m.failed_topup_id ?? null,
      user_id: m.wallet_user_id ?? m.user_id ?? null,
      request_payload: payload,
      response_status: responseStatus,
      response_body: responseBody,
      local_total_used_before: localBefore,
      local_total_used_after: localAfter,
      master_total_used_after: responseBody?.total_used ?? null,
      master_duplicate: responseBody?.duplicate ?? null,
      error_message: errorMessage,
    });
  } catch (auditErr) {
    console.warn("tenant_usage_audit insert failed:", auditErr);
  }
}
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
        method: "GET",
        allowDirectFallback: true,
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
// Read LIVE spend_cap + amount_spent from Meta. Used as base for top-up
// calculations so manual changes in Ads Manager don't cause drift.
async function fetchLiveSpendCap(actId, bmToken) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await delay(2000);
    try {
      const res = await metaFetch(
        `https://graph.facebook.com/v23.0/${actId}?fields=spend_cap,amount_spent&access_token=${encodeURIComponent(bmToken)}`,
        { method: "GET", allowDirectFallback: true }
      );
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok && !data?.error && data?.spend_cap !== undefined) {
        return {
          ok: true,
          spendCapDollars: centsToDollars(Number(data.spend_cap || 0)),
          amountSpentDollars: centsToDollars(Number(data.amount_spent || 0)),
          error: null,
        };
      }
      if (attempt === 1) {
        return { ok: false, error: data?.error?.message || `Live read HTTP ${res.status}` };
      }
    } catch (err) {
      if (attempt === 1) {
        return { ok: false, error: err instanceof Error ? err.message : "live read network error" };
      }
    }
  }
  return { ok: false, error: "live read exhausted" };
}
function isMetaRateLimited(status, data) {
  const message = String(data?.error?.message ?? "").toLowerCase();
  return status === 429 || data?.error?.code === 17 || data?.error?.code === 32 || data?.error?.code === 4 || message.includes("user request limit reached") || message.includes("request limit");
}
function explainMetaFailure(status, data, fallbackMessage) {
  const err = data?.error ?? {};
  const message = String(err.message || fallbackMessage || `Meta HTTP ${status}`);
  const code = String(err.code ?? "");
  const subcode = String(err.error_subcode ?? "");
  const lower = `${message} ${err.error_user_title || ""} ${err.error_user_msg || ""}`.toLowerCase();
  if (isMetaRateLimited(status, data)) return {
    category: "rate_limit", code: "META_RATE_LIMIT", reason: "Meta সাময়িকভাবে এই access token/IP থেকে অতিরিক্ত request পেয়েছে।", action: "কয়েক মিনিট অপেক্ষা করে Retry করুন; বারবার ক্লিক করবেন না।"
  };
  if (code === "190" || lower.includes("access token") || lower.includes("session has expired")) return {
    category: "authentication", code: `META_${code || "AUTH"}${subcode ? `_${subcode}` : ""}`, reason: "Business Manager access token মেয়াদোত্তীর্ণ বা বাতিল হয়েছে।", action: "BM token পুনরায় সংযুক্ত/আপডেট করে তারপর Retry করুন।"
  };
  if (code === "100" || lower.includes("invalid parameter")) return {
    category: "invalid_parameter", code: `META_100${subcode ? `_${subcode}` : ""}`, reason: "Meta প্রস্তাবিত spend cap গ্রহণ করেনি। সাধারণত account restriction, billing/prepaid mode, currency rounding, বা বর্তমান spend-এর চেয়ে cap কম হলে এটি হয়।", action: "Ads Manager-এ account status, payment method, current spend ও spend limit যাচাই করুন; live cap sync করে তারপর Retry করুন।"
  };
  if (lower.includes("permission") || code === "10" || code === "200") return {
    category: "permission", code: `META_${code || "PERMISSION"}${subcode ? `_${subcode}` : ""}`, reason: "সংযুক্ত token-এর এই ad account-এর spend cap পরিবর্তনের permission নেই।", action: "BM-তে token user-কে Finance/Admin access দিন অথবা সঠিক BM token সংযুক্ত করুন।"
  };
  return {
    category: "meta_rejected", code: `META_${code || status || "ERROR"}${subcode ? `_${subcode}` : ""}`, reason: message, action: "Ads Manager-এ account ও billing status যাচাই করুন; সমস্যা সাময়িক হলে কিছুক্ষণ পরে Retry করুন।"
  };
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
  resetMetaCounters();
  const json = (body, status = 200)=>new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  const metaCallSummary = () => sharedMetaCallSummary(" ");
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
    const { ad_account_id, amount, deduct_wallet, target_user_id, wallet_kind: walletKindRaw } = await req.json();
    if (!ad_account_id || !amount) return json({
      error: "ad_account_id and amount required"
    }, 400);
    const walletKind = walletKindRaw === "secondary" ? "secondary" : "primary";


    // ============================================
    // IDEMPOTENCY GUARD: prevent double top-up
    // ============================================
    // If the same user submitted the same (ad_account_id, amount) within the
    // last 60 seconds, treat it as a duplicate submission (double-click,
    // network retry, etc.) and refuse silently. This prevents wallet from
    // being charged twice and the spend cap from being incremented twice.
    const dedupeUserId = target_user_id || userId;
    try {
      const since = new Date(Date.now() - 60_000).toISOString();
      const { data: recentDup } = await supabase
        .from("transactions")
        .select("id, created_at")
        .eq("user_id", dedupeUserId)
        .eq("type", "ad_topup")
        .eq("reference_id", ad_account_id)
        .eq("amount", -Number(amount))
        .gte("created_at", since)
        .limit(1);
      if (recentDup && recentDup.length > 0) {
        console.warn(`Duplicate top-up blocked: user=${dedupeUserId} acct=${ad_account_id} amount=${amount} (within 60s of ${recentDup[0].created_at})`);
        return json({
          error: "Duplicate top-up detected (same amount submitted within the last 60 seconds). Please refresh to see the result of the previous request.",
          code: "DUPLICATE_TOPUP",
        }, 409);
      }
    } catch (dedupeErr) {
      console.warn("Dedupe check failed (non-blocking):", dedupeErr);
    }

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

    // Stable idempotency key for any usage report this invocation may emit
    // (success, POST-error recovery, network-error recovery). Same logical
    // top-up = same key, so master never double-counts. Tie to wallet txn id
    // when possible — globally unique. Fallback uses a coarser tuple.
    let usageIdempotencyKey = `topup:${ad_account_id}:${amount}:${Math.floor(Date.now() / 1000)}`;
    // ============================================
    // STEP 1: Deduct wallet FIRST (before Meta API)
    // ============================================
    let newBalance = null;
    let walletId = null;
    let walletTxnId: string | null = null;
    if (shouldDeductWallet) {
      const cleanAccountId = account.account_id.replace(/^act_/, '');
      let dueLimit = 0;
      const { data: prof } = await supabase
        .from("profiles")
        .select("due_limit, secondary_wallet_enabled")
        .eq("user_id", walletUserId)
        .single();
      if (!isAdmin) {
        dueLimit = Number(prof?.due_limit ?? 0);
      }
      if (walletKind === "secondary" && !prof?.secondary_wallet_enabled) {
        return json({ error: "Secondary wallet is not enabled for this client" }, 400);
      }

      // ATOMIC + ledger-consistent deduction. The DB function locks the chosen
      // wallet row (main or secondary), realigns its balance with that wallet's
      // transaction ledger if they have drifted, then deducts. This makes it
      // impossible for a top-up to leave the balance HIGHER than before.
      const { data: deductRes, error: deductErr } = await supabase.rpc("deduct_wallet_for_topup_v2", {
        p_user_id: walletUserId,
        p_amount: amount,
        p_ad_account_id: ad_account_id,
        p_description: `${account.account_name}\n${cleanAccountId}`,
        p_processed_by: isAdmin ? `admin:${userId}` : `client:${walletUserId}`,
        p_wallet_kind: walletKind,
        p_allow_negative: isAdmin,
        p_due_limit: walletKind === "primary" ? dueLimit : 0,
      });

      const walletLabel = walletKind === "secondary" ? "Secondary wallet" : "Wallet";
      if (deductErr) {
        console.error("deduct_wallet_for_topup_v2 failed", deductErr);
        return json({ error: `${walletLabel} deduction failed. Please try again.` }, 500);
      }
      const res: any = deductRes;
      if (!res?.ok) {
        if (res?.error === "wallet_not_found") return json({ error: `${walletLabel} not found for user` }, 404);
        if (res?.error === "insufficient_balance") return json({ error: `Insufficient ${walletKind === "secondary" ? "secondary wallet" : "wallet"} balance` }, 400);
        return json({ error: `${walletLabel} deduction failed` }, 400);
      }

      newBalance = Number(res.balance_after);
      walletId = res.wallet_id;
      walletTxnId = res.transaction_id ?? null;
      if (res.reconciled) {
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: "Wallet Balance Reconciled",
          details: `Wallet for user ${walletUserId} was realigned to its transaction ledger before top-up (new balance $${Number(res.balance_before).toFixed(2)} → $${newBalance.toFixed(2)} after $${amount} deduction).`,
        });
      }
      if (walletTxnId) usageIdempotencyKey = `wallet_txn:${walletTxnId}`;
    }

    // ============================================
    // STEP 2: Call Meta API
    // ============================================
    const bm = account.business_managers;
    const bmToken = await decryptToken(bm.access_token, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const actId = account.account_id.startsWith("act_") ? account.account_id : `act_${account.account_id}`;
    // ============================================
    // STEP 2a: READ LIVE spend_cap from Meta (drift-safe)
    // ============================================
    // CRITICAL: We must use the live Meta value as the base, NOT the DB
    // value. Otherwise, if someone manually changes the cap in Ads Manager
    // without "Update from Meta", the next top-up will be calculated from
    // a stale base and set the wrong final cap.
    const dbSpendCapDollars = Number(account.spend_cap);
    const live = await fetchLiveSpendCap(actId, bmToken);
    if (!live.ok) {
      // Refund the SAME wallet the amount was deducted from
      if (shouldDeductWallet && walletId !== null) {
        const walletTable = walletKind === "secondary" ? "secondary_wallets" : "wallets";
        const { data: walletNow } = await supabase.from(walletTable).select("balance").eq("id", walletId).single();
        const refundedBalance = Number(walletNow?.balance ?? newBalance) + amount;
        await supabase.from(walletTable).update({ balance: refundedBalance }).eq("id", walletId);
        await supabase.from("transactions").insert({
          user_id: walletUserId,
          amount: amount,
          balance_after: refundedBalance,
          type: "refund",
          description: `Auto-refund: could not read live spend cap from Meta (${live.error})`,
          reference_id: ad_account_id,
          processed_by: isAdmin ? `admin:${userId}` : `client:${walletUserId}`,
          wallet_kind: walletKind,
        });
      }

      await supabase.from("system_logs").insert({
        user_id: userId,
        user_name: userName,
        action: "Top-Up Cancelled",
        details: `${account.account_name} (${actId.replace(/^act_/, '')}) — Could not read live spend cap from Meta: ${live.error}. Top-up cancelled${shouldDeductWallet ? ", wallet refunded" : ""}.`,
      });
      return json({
        error: `Cannot read live spend cap from Meta: ${live.error}. Top-up cancelled${shouldDeductWallet ? " and wallet refunded" : ""}.`,
      }, 400);
    }
    const liveSpendCapDollars = live.spendCapDollars;
    const liveAmountSpentDollars = live.amountSpentDollars;
    // Drift detection — log when DB and Meta disagree by more than $1
    const drift = liveSpendCapDollars - dbSpendCapDollars;
    if (Math.abs(drift) > 1) {
      await supabase.from("system_logs").insert({
        user_id: userId,
        user_name: userName,
        action: "Spend Cap Drift Detected",
        details: `${account.account_name} (${actId.replace(/^act_/, '')}) — DB=$${dbSpendCapDollars.toFixed(2)}, Meta=$${liveSpendCapDollars.toFixed(2)}, drift=$${drift.toFixed(2)}. Top-up calculated from live Meta value.`,
      });
    }
    // Use LIVE value as base — this is the fix
    const oldSpendCapDollars = liveSpendCapDollars;
    // Meta rejects fractional spend_cap values with a generic "Invalid parameter"
    // (error code 100). Accounts whose cap sits at the $0.01 minimum would make
    // every new cap fractional, so round UP to the next whole currency unit —
    // the client never loses money that way.
    const newSpendCapDollars = Math.ceil(liveSpendCapDollars + amount);

    console.log("Spend cap update attempt", {
      actId,
      bmId: bm.bm_id,
      dbSpendCapDollars,
      liveSpendCapDollars,
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
        }),
        // Spend cap update is a critical write — if the proxy is down, allow a
        // single direct call so the user's top-up doesn't get blocked entirely.
        allowDirectFallback: true,
      });
      if (!metaRes.ok || metaData?.error) {
        const mErr = metaData?.error ?? {};
        const metaErrorMsg = [
          mErr.message || `Meta HTTP ${metaRes.status}`,
          mErr.error_user_title ? `— ${mErr.error_user_title}` : "",
          mErr.error_user_msg ? `: ${mErr.error_user_msg}` : "",
          mErr.code !== undefined ? ` (code ${mErr.code}${mErr.error_subcode ? `/${mErr.error_subcode}` : ""})` : "",
        ].join("");

        const rateLimited = isMetaRateLimited(metaRes.status, metaData);
        const failure = explainMetaFailure(metaRes.status, metaData, metaErrorMsg);
        console.warn("Meta POST failed", {
          actId,
          status: metaRes.status,
          message: metaErrorMsg
        });
        // CRITICAL: POST may have succeeded despite error response.
        // Do a GET to check if spend cap was actually updated.
        let actuallySucceeded = false;
        let verificationReadSucceeded = false;
        try {
          // Retry the confirmation read a few times — Meta can be slow or
          // rate-limited, and a missed confirmation creates a false "failed"
          // top-up that the client can then duplicate.
          for (const waitMs of [0, 4000, 8000]) {
            if (waitMs) await delay(waitMs);
            const verifyResult = await verifySpendCap(actId, bmToken);
            if (verifyResult.ok) {
              verificationReadSucceeded = true;
              if (isCapEffectivelyApplied(verifyResult.dollars, newSpendCapDollars)) {
                actuallySucceeded = true;
                console.log(`POST returned error but GET confirms cap at $${verifyResult.dollars} (expected $${newSpendCapDollars}). Treating as success.`);
              }
              break;
            }
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
            details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars} (recovered from POST error)${metaCallSummary()}`
          });
          // Report usage to master so tenant total_used stays accurate even
          // on recovered-after-error successes.
          if (isTenantMode) {
            await reportUsageToMaster(licenseMap, amount, usageIdempotencyKey, supabase, "spend-cap-update", { ad_account_id, account_name: account.account_name, account_external_id: actId.replace(/^act_/, ""), wallet_txn_id: walletTxnId, wallet_user_id: walletUserId });
          }
          return json({
            success: true,
            old_spend_cap: oldSpendCapDollars,
            new_spend_cap: newSpendCapDollars
          });
        }
        // If every confirmation read failed, Meta's write outcome is unknown.
        // Never present that as a definitive failure or encourage an unsafe retry.
        const outcomeUnknown = !verificationReadSucceeded;
        const recordedFailure = outcomeUnknown ? {
          category: "network_ambiguous",
          code: "META_OUTCOME_UNKNOWN",
          reason: `Meta response failed and the live cap could not be read to confirm the outcome: ${metaErrorMsg}`,
          action: "এখনই Retry বা Refund করবেন না। Ads Manager-এ live spend cap যাচাই করুন; কয়েক মিনিট পরে action নিলে system আবার live check করবে।"
        } : failure;
        // Confirmed or ambiguous failure — insert into failed_topups
        const { data: failedRecord } = await supabase.from("failed_topups").insert({
          user_id: walletUserId,
          ad_account_id,
          amount,
          old_spend_cap: oldSpendCapDollars,
          error_message: metaErrorMsg,
          status: "pending",
          wallet_kind: walletKind,
          wallet_transaction_id: walletTxnId,
          expected_spend_cap: newSpendCapDollars,
          failure_code: recordedFailure.code,
          failure_category: recordedFailure.category,
          verification_status: outcomeUnknown ? "unknown" : "confirmed_not_applied",
          failure_reason: recordedFailure.reason,
          recommended_action: recordedFailure.action,
          meta_error_code: mErr.code !== undefined ? String(mErr.code) : null,
          meta_error_subcode: mErr.error_subcode !== undefined ? String(mErr.error_subcode) : null,
          http_status: metaRes.status
        }).select("id").single();
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: outcomeUnknown ? "Top-Up Verification Pending" : "Top-Up Failed",
          details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${amount}\nStatus: ${outcomeUnknown ? "Unknown — Meta may have applied the cap" : "Confirmed failed (Meta did not apply the cap)"}\nCode: ${recordedFailure.code}\nReason: ${recordedFailure.reason}\nMeta response: ${metaErrorMsg}\nWhat to do: ${recordedFailure.action}\nWallet: ${walletKind}; debit transaction: ${walletTxnId ?? "not charged"}${metaCallSummary()}`
        });
        const errorCode = rateLimited ? "META_RATE_LIMIT" : "META_API_ERROR";
        return json({
          error: rateLimited ? "Meta API is busy (rate limit reached). Amount deducted from wallet. You can retry from Failed Top-Ups." : `Meta API error: ${metaErrorMsg}. Amount deducted from wallet. You can retry from Failed Top-Ups.`,
          code: errorCode,
          failed_topup_id: failedRecord?.id,
          wallet_charged: shouldDeductWallet
        }, rateLimited ? 429 : 400);
      }
      // Verify with GET.
      // IMPORTANT: the POST above returned 200 OK, so Meta ACCEPTED the cap.
      // A failing/rate-limited verify GET must NOT be reported as a failed
      // top-up (that caused false "failed" entries + double top-ups).
      let verifyResult = await verifySpendCap(actId, bmToken);
      if (!verifyResult.ok) {
        // extra attempts with longer backoff before giving up on verification
        for (const waitMs of [5000, 10000]) {
          await delay(waitMs);
          verifyResult = await verifySpendCap(actId, bmToken);
          if (verifyResult.ok) break;
        }
      }
      if (!verifyResult.ok) {
        const verifyErrorMsg = verifyResult.error || "Meta verify failed";
        console.warn("Verification unreadable — POST was accepted, treating as success", { actId, message: verifyErrorMsg });
        await recordCapOnTxn(oldSpendCapDollars, newSpendCapDollars);
        await supabase.from("system_logs").insert({
          user_id: userId,
          user_name: userName,
          action: "Spend Cap Updated (Unverified)",
          details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars}. Meta accepted the update but the verification read failed (${verifyErrorMsg}). Not marked as failed to avoid a duplicate top-up.${metaCallSummary()}`
        });
      } else if (isCapEffectivelyApplied(verifyResult.dollars, newSpendCapDollars)) {
        console.log(`Meta verified: $${verifyResult.dollars} (expected $${newSpendCapDollars})`);
      } else {
        // Mismatch — re-read once more; Meta is often just slow to reflect it.
        await delay(6000);
        const recheck = await verifySpendCap(actId, bmToken);
        if (recheck.ok && isCapEffectivelyApplied(recheck.dollars, newSpendCapDollars)) {
          console.log(`Meta verified on recheck: $${recheck.dollars}`);
        } else if (!recheck.ok) {
          await supabase.from("system_logs").insert({
            user_id: userId,
            user_name: userName,
            action: "Spend Cap Updated (Unverified)",
            details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars}. Recheck read failed; not marked as failed.${metaCallSummary()}`
          });
        } else {
          const verifiedDollars = recheck.dollars;
          const mismatchMsg = `Verification mismatch: expected $${newSpendCapDollars}, got $${verifiedDollars}`;
          console.warn(mismatchMsg);
          const { data: failedRecord } = await supabase.from("failed_topups").insert({
            user_id: walletUserId,
            ad_account_id: ad_account_id,
            amount: amount,
            old_spend_cap: oldSpendCapDollars,
            error_message: mismatchMsg,
            status: "pending",
            wallet_kind: walletKind,
            wallet_transaction_id: walletTxnId,
            expected_spend_cap: newSpendCapDollars,
            failure_code: "META_VERIFY_MISMATCH",
            failure_category: "verification_mismatch",
            verification_status: "confirmed_not_applied",
            failure_reason: `Meta accepted the request but returned spend cap $${verifiedDollars}; expected $${newSpendCapDollars}.`,
            recommended_action: "Ads Manager-এ live spend cap যাচাই করুন; cap না বাড়লে Retry করুন, বাড়লে Refund চাপবেন না।"
          }).select("id").single();
          await supabase.from("system_logs").insert({
            user_id: userId,
            user_name: userName,
            action: "Top-Up Failed",
            details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${amount}\nStatus: Verification mismatch\nCode: META_VERIFY_MISMATCH\nReason: ${mismatchMsg}\nWhat to do: Ads Manager-এ live spend cap যাচাই করুন; cap না বাড়লে Retry করুন, বাড়লে Refund চাপবেন না।\nWallet: ${walletKind}; debit transaction: ${walletTxnId ?? "not charged"}${metaCallSummary()}`
          });
          return json({
            error: `${mismatchMsg}. Amount deducted from wallet. You can retry from Failed Top-Ups.`,
            failed_topup_id: failedRecord?.id,
            wallet_charged: shouldDeductWallet
          }, 400);
        }
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
            details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars} (recovered from network error: ${metaErrorMsg})${metaCallSummary()}`
          });
          // Report usage to master so tenant total_used stays accurate even
          // on recovered-after-network-error successes.
          if (isTenantMode) {
            await reportUsageToMaster(licenseMap, amount, usageIdempotencyKey, supabase, "spend-cap-update", { ad_account_id, account_name: account.account_name, account_external_id: actId.replace(/^act_/, ""), wallet_txn_id: walletTxnId, wallet_user_id: walletUserId });
          }
          await recordCapOnTxn(oldSpendCapDollars, newSpendCapDollars);
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
      const networkAction = "এখনই Retry বা Refund করবেন না। Ads Manager-এ live spend cap যাচাই করুন; কয়েক মিনিট পরে Failed Top-Ups থেকে action নিলে system আবার live check করবে।";
      // Insert into failed_topups
      const { data: failedRecord } = await supabase.from("failed_topups").insert({
        user_id: walletUserId,
        ad_account_id: ad_account_id,
        amount: amount,
        old_spend_cap: oldSpendCapDollars,
        error_message: safeMsg,
        status: "pending",
        wallet_kind: walletKind,
        wallet_transaction_id: walletTxnId,
        expected_spend_cap: newSpendCapDollars,
        failure_code: "META_OUTCOME_UNKNOWN",
        failure_category: "network_ambiguous",
        verification_status: "unknown",
        failure_reason: `Meta response পাওয়া যায়নি এবং confirmation read-ও নির্ভরযোগ্য ছিল না: ${metaErrorMsg}`,
        recommended_action: networkAction
      }).select("id").single();
      await supabase.from("system_logs").insert({
        user_id: userId,
        user_name: userName,
        action: "Top-Up Verification Pending",
        details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${amount}\nStatus: Unknown — Meta may have applied the cap\nCode: META_OUTCOME_UNKNOWN\nReason: Network/response error: ${metaErrorMsg}\nWhat to do: ${networkAction}\nWallet: ${walletKind}; debit transaction: ${walletTxnId ?? "not charged"}${metaCallSummary()}`
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
    // Use LIVE amount_spent (read in STEP 2a) instead of stale DB value
    // so the UI's "Remaining Balance" is accurate immediately.
    const currentAmountSpent = liveAmountSpentDollars;
    const remainingAfterTopup = newSpendCapDollars - currentAmountSpent;
    await supabase.from("ad_accounts").update({
      spend_cap: newSpendCapDollars,
      amount_spent: currentAmountSpent,
      balance_after_topup: remainingAfterTopup
    }).eq("id", ad_account_id);
    // Log success
    await supabase.from("system_logs").insert({
      user_id: userId,
      user_name: userName,
      action: "Spend Cap Updated",
      details: `${account.account_name} (${actId.replace(/^act_/, '')}) — $${oldSpendCapDollars} → $${newSpendCapDollars}${metaCallSummary()}`
    });
    // Record the cap movement on the wallet transaction so the client's
    // transaction history shows previous limit → new spend cap.
    await recordCapOnTxn(oldSpendCapDollars, newSpendCapDollars);


    // ============================================
    // STEP 4.5: Post-update health check — diagnostic
    // ============================================
    let billingWarning = null;
    try {
      const healthRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=account_status,disable_reason,funding_source_details&access_token=${encodeURIComponent(bmToken)}`, {
        method: "GET",
        allowDirectFallback: true,
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
      // Detect "hold" — account ostensibly active but Meta refuses to charge / disabled.
      // Meta status codes: 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, 7=PENDING_RISK_REVIEW,
      // 8=PENDING_SETTLEMENT, 9=IN_GRACE_PERIOD, 100=PENDING_CLOSURE, 101=CLOSED, 201=ANY_ACTIVE, 202=ANY_CLOSED.
      const HOLD_STATUSES = new Set([2, 3, 7, 8, 9, 100, 101]);
      const fundDetails = healthData?.funding_source_details || null;
      const failedAttempts = Number(fundDetails?.failed_attempts ?? 0);
      const isHold =
        (metaStatus !== null && HOLD_STATUSES.has(Number(metaStatus))) ||
        failedAttempts > 0 ||
        !!disableReason;
      let holdReason: string | null = null;
      if (metaStatus === 2) holdReason = `Disabled by Meta (reason ${disableReason ?? "?"})`;
      else if (metaStatus === 3) holdReason = "Unsettled balance";
      else if (metaStatus === 7) holdReason = "Pending risk review";
      else if (metaStatus === 8) holdReason = "Pending settlement";
      else if (metaStatus === 9) holdReason = "In grace period (billing failed)";
      else if (failedAttempts > 0) holdReason = `Card failed ${failedAttempts}× — temporary hold not placed`;
      else if (disableReason) holdReason = `Disable reason ${disableReason}`;

      try {
        await supabase.from("ad_accounts").update({
          meta_account_status: metaStatus,
          meta_disable_reason: disableReason,
          meta_hold_detected: isHold,
          meta_hold_reason: holdReason,
          meta_health_checked_at: new Date().toISOString(),
        }).eq("id", ad_account_id);
      } catch (e) { console.warn("hold flag update failed:", e); }

      if (metaStatus && metaStatus !== 1) {
        billingWarning = {
          account_status: metaStatus,
          disable_reason: disableReason,
          hold: isHold,
          hold_reason: holdReason,
          message: holdReason || `Account status is ${metaStatus} after top-up.`,
        };
        console.warn("Post-topup health warning:", billingWarning);
      }
    } catch (healthErr) {
      console.warn("Post-topup health check failed:", healthErr);
    }

    // Persist rate-limit headers + per-call log captured during this invocation
    try {
      const { persistMetaRateLimits } = await import("../_shared/persist-rate-limits.ts");
      await persistMetaRateLimits(supabase, {
        ad_account_db_ids: [ad_account_id],
        business_manager_db_id: (account as any).business_manager_id ?? null,
        account_id_map: { [actId]: ad_account_id },
      });
    } catch (e) { console.warn("rate-limit persist failed (spend-cap-update):", e); }
    // ============================================
    // STEP 5: Report usage to master (Tenant mode)
    // ============================================
    if (isTenantMode) {
      await reportUsageToMaster(licenseMap, amount, usageIdempotencyKey, supabase, "spend-cap-update", { ad_account_id, account_name: account.account_name, account_external_id: actId.replace(/^act_/, ""), wallet_txn_id: walletTxnId, wallet_user_id: walletUserId });
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
