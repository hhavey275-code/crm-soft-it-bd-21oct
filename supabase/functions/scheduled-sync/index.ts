import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";
// Track route + IP used for the most recent Meta API call (per request).
// `lastMetaVia` tells you whether the call actually went via proxy or direct,
// independent of whether we managed to capture an IP. `lastMetaProxyIp` keeps
// the legacy variable name used in log strings further down in this file.
let lastMetaVia = "direct";
let lastMetaProxyIp = "direct";
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
      // 8s timeout so a hung proxy can't block this background job.
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
      // Fallback on ANY non-2xx, HTML body, or proxy-shape error.
      const shouldFallback = looksLikeHtml || isProxyOwnError || proxyRes.status < 200 || proxyRes.status >= 300;
      if (!shouldFallback) {
        // Proxy succeeded — capture egress IP (proxy returns x-egress-ip;
        // older proxies may use x-proxy-ip, so check both).
        const proxyIp = proxyRes.headers.get("x-egress-ip") || proxyRes.headers.get("x-proxy-ip");
        lastMetaVia = "proxy";
        lastMetaProxyIp = proxyIp || "proxy";
        return new Response(text, {
          status: proxyRes.status,
          headers: proxyRes.headers
        });
      }
      console.warn(`Proxy unhealthy (status=${proxyRes.status}, html=${looksLikeHtml}, proxyErr=${isProxyOwnError}) — direct fallback`);
    } catch (proxyErr) {
      console.warn("Proxy failed, falling back to direct call:", proxyErr?.message || proxyErr);
    }
  }
  lastMetaVia = "direct";
  lastMetaProxyIp = "direct";
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
const delay = (ms)=>new Promise((r)=>setTimeout(r, ms));
function centsToDollars(cents) {
  return cents / 100;
}
// Fetch all pages with delay between pages
async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;
  while(nextUrl){
    const res = await metaFetch(nextUrl);
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    results.push(...data.data ?? []);
    nextUrl = data.paging?.next ?? null;
    if (nextUrl) await delay(300);
  }
  return results;
}
async function processAutoTopups(supabase, serviceKey) {
  // Fetch all active auto top-up rules
  const { data: rules, error: rulesErr } = await supabase.from("auto_topup_rules").select("*").eq("is_active", true);
  if (rulesErr || !rules || rules.length === 0) return {
    processed: 0,
    triggered: 0
  };
  let triggered = 0;
  const ONE_HOUR = 60 * 60 * 1000;
  for (const rule of rules){
    try {
      // Check cooldown (1 hour)
      if (rule.last_triggered_at) {
        const elapsed = Date.now() - new Date(rule.last_triggered_at).getTime();
        if (elapsed < ONE_HOUR) continue;
      }
      // Fetch the ad account's current balance
      const { data: account, error: accErr } = await supabase.from("ad_accounts").select("*, business_managers!inner(access_token, bm_id, id)").eq("id", rule.ad_account_id).single();
      if (accErr || !account) continue;
      const currentBalance = Number(account.spend_cap) - Number(account.amount_spent);
      // Check if balance is at or below threshold
      if (currentBalance > rule.threshold_balance) continue;
      // Check wallet balance
      const { data: wallet, error: walletErr } = await supabase.from("wallets").select("id, balance").eq("user_id", rule.user_id).single();
      if (walletErr || !wallet) continue;
      const { data: prof } = await supabase.from("profiles").select("due_limit, full_name").eq("user_id", rule.user_id).single();
      const dueLimit = Number(prof?.due_limit ?? 0);
      const userName = prof?.full_name || "Unknown";
      if (Number(wallet.balance) + dueLimit < rule.topup_amount) {
        console.log(`Auto top-up skipped for ${account.account_name}: insufficient wallet balance ($${wallet.balance} + $${dueLimit} < $${rule.topup_amount})`);
        continue;
      }
      // Deduct wallet
      const newBalance = Number(wallet.balance) - rule.topup_amount;
      await supabase.from("wallets").update({
        balance: newBalance
      }).eq("id", wallet.id);
      // Create transaction
      const cleanAccountId = account.account_id.replace(/^act_/, '');
      await supabase.from("transactions").insert({
        user_id: rule.user_id,
        amount: -rule.topup_amount,
        balance_after: newBalance,
        type: "ad_topup",
        description: `Auto Top-Up\n${account.account_name}\n${cleanAccountId}`,
        reference_id: rule.ad_account_id,
        processed_by: `auto:${rule.user_id}`
      });
      // Call Meta API to update spend cap
      const bm = account.business_managers;
      const bmToken = await decryptToken(bm.access_token, serviceKey);
      const oldSpendCap = Number(account.spend_cap);
      const newSpendCap = oldSpendCap + rule.topup_amount;
      const actId = account.account_id.startsWith("act_") ? account.account_id : `act_${account.account_id}`;
      const metaRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          spend_cap: String(newSpendCap),
          access_token: bmToken
        })
      });
      const metaData = await metaRes.json();
      // Verify the spend cap was actually set (same pattern as spend-cap-update)
      let actuallySucceeded = metaRes.ok && !metaData?.error;
      if (!actuallySucceeded) {
        // POST may have succeeded despite error response — do a GET to verify
        try {
          const checkRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=spend_cap&access_token=${encodeURIComponent(bmToken)}`, {
            method: "GET"
          });
          const checkData = await checkRes.json();
          if (checkData?.spend_cap !== undefined) {
            const currentCapDollars = centsToDollars(Number(checkData.spend_cap));
            if (Math.abs(currentCapDollars - newSpendCap) < 0.02) {
              actuallySucceeded = true;
              console.log(`Auto top-up POST returned error but GET confirms cap updated to $${currentCapDollars}`);
            }
          }
        } catch (verifyErr) {
          console.warn("Auto top-up verification GET failed:", verifyErr);
        }
      } else {
        // POST succeeded — still verify with GET
        try {
          await delay(500);
          const verifyRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=spend_cap&access_token=${encodeURIComponent(bmToken)}`, {
            method: "GET"
          });
          const verifyData = await verifyRes.json();
          if (verifyData?.spend_cap !== undefined) {
            const verifiedDollars = centsToDollars(Number(verifyData.spend_cap));
            if (Math.abs(verifiedDollars - newSpendCap) >= 0.02) {
              console.warn(`Auto top-up verification mismatch: expected $${newSpendCap}, got $${verifiedDollars}`);
              actuallySucceeded = false;
            } else {
              console.log(`Auto top-up verified: $${verifiedDollars} (expected $${newSpendCap})`);
            }
          }
        } catch (verifyErr) {
          console.warn("Auto top-up verification failed:", verifyErr);
        }
      }
      if (!actuallySucceeded) {
        // Meta failed — refund wallet
        await supabase.from("wallets").update({
          balance: Number(wallet.balance)
        }).eq("id", wallet.id);
        await supabase.from("transactions").insert({
          user_id: rule.user_id,
          amount: rule.topup_amount,
          balance_after: Number(wallet.balance),
          type: "refund",
          description: `Auto Top-Up Failed Refund\n${account.account_name}`,
          reference_id: rule.ad_account_id,
          processed_by: `auto:${rule.user_id}`
        });
        console.error(`Auto top-up Meta API failed for ${actId}: ${metaData?.error?.message || 'Verification failed'}`);
        // Notify admins
        const { data: adminUsers } = await supabase.from("user_roles").select("user_id").in("role", [
          "admin",
          "superadmin"
        ]);
        if (adminUsers) {
          for (const admin of adminUsers){
            await supabase.from("notifications").insert({
              user_id: admin.user_id,
              type: "auto_topup_failed",
              title: "Auto Top-Up Failed",
              message: `${account.account_name} (${cleanAccountId}) — $${rule.topup_amount} — ${metaData?.error?.message || 'Verification failed'}`,
              reference_id: rule.ad_account_id
            });
          }
        }
        await supabase.from("system_logs").insert({
          user_id: rule.user_id,
          user_name: userName,
          action: "Auto Top-Up Failed",
          details: `${account.account_name} (${cleanAccountId}) — $${rule.topup_amount} — ${metaData?.error?.message || 'Verification failed'} [via=${lastMetaVia} IP: ${lastMetaProxyIp}]`
        });
        continue;
      }
      // Success — update DB
      const currentAmountSpent = Number(account.amount_spent);
      const remainingAfterTopup = newSpendCap - currentAmountSpent;
      await supabase.from("ad_accounts").update({
        spend_cap: newSpendCap,
        balance_after_topup: remainingAfterTopup
      }).eq("id", rule.ad_account_id);
      // Update last_triggered_at
      await supabase.from("auto_topup_rules").update({
        last_triggered_at: new Date().toISOString()
      }).eq("id", rule.id);
      // Log API calls
      if (bm.id) {
        await supabase.from("api_call_logs").insert({
          business_manager_id: bm.id,
          function_name: "auto-topup",
          call_count: 1
        });
      }
      // System log
      await supabase.from("system_logs").insert({
        user_id: rule.user_id,
        user_name: userName,
        action: "Auto Top-Up",
        details: `${account.account_name} (${cleanAccountId}) — $${oldSpendCap} → $${newSpendCap} (triggered at balance $${currentBalance.toFixed(2)}, threshold $${rule.threshold_balance}) [via=${lastMetaVia} IP: ${lastMetaProxyIp}]`
      });
      console.log(`Auto top-up SUCCESS: ${actId} $${oldSpendCap} → $${newSpendCap}`);
      triggered++;
    } catch (err) {
      console.error(`Auto top-up error for rule ${rule.id}:`, err);
    }
  }
  return {
    processed: rules.length,
    triggered
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    // Auth check: require internal job secret, service_role key, or admin JWT
    const jobSecret = req.headers.get("x-job-secret");
    const authHeader = req.headers.get("Authorization");
    let authenticated = false;
    // Path 1: Internal job secret (used by cron & manual SQL trigger)
    if (jobSecret) {
      const adminClient = createClient(supabaseUrl, serviceKey);
      const { data: secretRow } = await adminClient.from("internal_job_secrets").select("secret").eq("job_name", "scheduled-sync").single();
      if (secretRow && secretRow.secret === jobSecret) {
        authenticated = true;
      }
    }
    // Path 2: Service role key as Bearer token
    if (!authenticated && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      if (token === serviceKey) {
        authenticated = true;
      } else {
        // Path 3: Admin JWT
        const userClient = createClient(supabaseUrl, anonKey, {
          global: {
            headers: {
              Authorization: authHeader
            }
          }
        });
        const { data: userData } = await userClient.auth.getUser();
        if (userData?.user) {
          const adminClient = createClient(supabaseUrl, serviceKey);
          const { data: roleRow } = await adminClient.from("user_roles").select("role").eq("user_id", userData.user.id).in("role", [
            "admin",
            "superadmin"
          ]).limit(1);
          if (roleRow && roleRow.length > 0) {
            authenticated = true;
          }
        }
      }
    }
    if (!authenticated) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: corsHeaders
      });
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    // --- STEP 1: Only sync accounts that have active auto_topup_rules ---
    const { data: activeRules, error: rulesError } = await supabase.from("auto_topup_rules").select("ad_account_id").eq("is_active", true);
    if (rulesError) throw rulesError;
    const autoTopupAccountIds = [
      ...new Set((activeRules ?? []).map((r)=>r.ad_account_id))
    ];
    let totalSynced = 0;
    if (autoTopupAccountIds.length > 0) {
      // Fetch only the ad accounts that need syncing
      const { data: accountsToSync } = await supabase.from("ad_accounts").select("id, account_id, amount_spent, spend_cap, business_manager_id, business_managers!inner(access_token, bm_id, id)").in("id", autoTopupAccountIds).eq("status", "active");
      // Group by BM for efficient token reuse
      const bmGroups = {};
      for (const acc of accountsToSync ?? []){
        const bmId = acc.business_manager_id;
        if (!bmId) continue;
        if (!bmGroups[bmId]) bmGroups[bmId] = {
          bm: acc.business_managers,
          accounts: []
        };
        bmGroups[bmId].accounts.push(acc);
      }
      for (const [bmId, group] of Object.entries(bmGroups)){
        try {
          const accessToken = await decryptToken(group.bm.access_token, serviceKey);
          for (const account of group.accounts){
            try {
              const actId = account.account_id.startsWith("act_") ? account.account_id : `act_${account.account_id}`;
              const res = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=amount_spent,spend_cap&access_token=${accessToken}`);
              const data = await res.json();
              if (data.error) {
                // Rate limit detection — stop this BM
                if (data.error.code === 4 || data.error.code === 17 || data.error.code === 32) {
                  console.error(`Rate limited on BM ${group.bm.bm_id}, skipping remaining accounts`);
                  break;
                }
                console.error(`Error syncing ${actId}:`, data.error.message);
                continue;
              }
              const metaAmountSpent = Number(data.amount_spent ?? 0) / 100;
              const metaSpendCapCents = Number(data.spend_cap ?? 0);
              const metaSpendCapDollars = metaSpendCapCents / 100;
              const updateData = {
                amount_spent: metaAmountSpent
              };
              if (metaSpendCapDollars > 0) {
                updateData.spend_cap = metaSpendCapDollars;
              }
              await supabase.from("ad_accounts").update(updateData).eq("id", account.id);
              totalSynced++;
            } catch (accErr) {
              console.error(`Error syncing account ${account.account_id}:`, accErr);
            }
          }
          // Log API calls
          if (group.bm.id) {
            await supabase.from("api_call_logs").insert({
              business_manager_id: group.bm.id,
              function_name: "scheduled-sync",
              call_count: group.accounts.length
            });
          }
        } catch (bmErr) {
          console.error(`Error with BM ${bmId}:`, bmErr);
        }
        await delay(500);
      }
    }
    // Process auto top-up rules after sync
    const autoTopupResult = await processAutoTopups(supabase, serviceKey);
    console.log(`Auto top-up: ${autoTopupResult.triggered}/${autoTopupResult.processed} rules triggered`);
    // Enforce ad campaign spend rules (auto-pause)
    let ruleEnforcement = {
      checked: 0,
      paused: 0
    };
    try {
      const enforceRes = await fetch(`${supabaseUrl}/functions/v1/ads-manager`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`
        },
        body: JSON.stringify({
          action: "enforce_rules"
        })
      });
      ruleEnforcement = await enforceRes.json();
      console.log(`Ad rules enforcement: paused ${ruleEnforcement.paused}/${ruleEnforcement.checked}`);
    } catch (ruleErr) {
      console.error("Rule enforcement failed:", ruleErr);
    }
    return new Response(JSON.stringify({
      success: true,
      accounts_synced: totalSynced,
      auto_topup_accounts: autoTopupAccountIds.length,
      auto_topup: autoTopupResult,
      ad_rules: ruleEnforcement
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("scheduled-sync error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error"
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
