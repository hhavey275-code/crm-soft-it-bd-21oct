import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";
let lastMetaVia = "direct";
let lastMetaIp: string | null = null;

async function decryptToken(stored: string, secret: string) {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({
      name: "PBKDF2",
      salt: enc.encode("bm-token-enc-v1"),
      iterations: 100000,
      hash: "SHA-256",
    }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch {
    return stored;
  }
}

function centsToDollars(cents: number) {
  return cents / 100;
}

async function metaFetch(url: string, options: RequestInit = {}) {
  if (!url.startsWith("https://graph.facebook.com/")) return fetch(url, options);
  const proxySecret = Deno.env.get("META_PROXY_SECRET")?.trim();
  const proxyUrl = (Deno.env.get("META_PROXY_URL") || DEFAULT_META_PROXY_URL).trim();
  if (proxySecret && proxyUrl) {
    try {
      const headers = new Headers(options.headers ?? {});
      const contentType = headers.get("Content-Type") ?? headers.get("content-type") ?? undefined;
      const method = options.method ?? "GET";
      const body = options.body instanceof URLSearchParams ? options.body.toString() : typeof options.body === "string" ? options.body : undefined;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret,
        },
        body: JSON.stringify({ url, method, body, contentType }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      try {
        const proxyIp = proxyRes.headers.get("x-egress-ip") || proxyRes.headers.get("x-proxy-ip");
        if (proxyIp) lastMetaIp = proxyIp;
      } catch {}
      const text = await proxyRes.text();
      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");
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
      const shouldFallback = looksLikeHtml || isProxyOwnError || proxyRes.status < 200 || proxyRes.status >= 300;
      if (!shouldFallback) {
        lastMetaVia = "proxy";
        return new Response(text, { status: proxyRes.status, headers: proxyRes.headers });
      }
      console.warn(`Proxy unhealthy (status=${proxyRes.status}, html=${looksLikeHtml}, proxyErr=${isProxyOwnError}) — direct fallback`);
    } catch (proxyErr: any) {
      console.warn("Proxy failed, falling back to direct call:", proxyErr?.message || proxyErr);
    }
  }
  lastMetaVia = "direct";
  lastMetaIp = null;
  return fetch(url, options);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userId = claimsData.claims.sub;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", userId).single();
    const isAdmin = roleRow?.role === "admin" || roleRow?.role === "superadmin";

    const { ad_account_id, amount, dry_run } = await req.json();
    const withdrawAmount = Number(amount);
    if (!ad_account_id || !Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
      return json({ error: "ad_account_id and positive amount required" }, 400);
    }

    if (!isAdmin) {
      const { data: assignment } = await supabase
        .from("user_ad_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("ad_account_id", ad_account_id)
        .single();
      if (!assignment) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    const { data: account, error: accountErr } = await supabase
      .from("ad_accounts")
      .select("*, business_managers!inner(access_token, bm_id)")
      .eq("id", ad_account_id)
      .single();

    if (accountErr || !account) {
      return json({ error: "Ad account not found" }, 404);
    }

    const { data: userProfile } = await supabase.from("profiles").select("full_name, email").eq("user_id", userId).single();
    const userName = userProfile?.full_name || userProfile?.email || "Unknown";

    const bm = account.business_managers;
    const bmToken = await decryptToken(bm.access_token, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const actId = account.account_id.startsWith("act_") ? account.account_id : `act_${account.account_id}`;

    const currentSpendCap = Number(account.spend_cap ?? 0);
    const fallbackSpent = Number(account.amount_spent ?? 0);
    let realAmountSpent = fallbackSpent;

    try {
      const insightsRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=amount_spent,spend_cap&access_token=${encodeURIComponent(bmToken)}`, { method: "GET" });
      const insightsData = await insightsRes.json().catch(() => null);
      if (insightsData?.amount_spent !== undefined) {
        realAmountSpent = centsToDollars(Number(insightsData.amount_spent));
      }
    } catch (err) {
      console.warn("Withdraw preflight read failed, using DB snapshot", err);
    }

    const maxWithdrawable = Math.max(0, currentSpendCap - realAmountSpent);
    if (dry_run) {
      return json({
        success: true,
        current_spend_cap: currentSpendCap,
        real_amount_spent: realAmountSpent,
        max_withdrawable: Number(maxWithdrawable.toFixed(2)),
        via: lastMetaVia,
        source_ip: lastMetaIp,
      });
    }

    if (withdrawAmount - maxWithdrawable > 0.019) {
      return json({
        error: `Max withdrawable is $${maxWithdrawable.toFixed(2)}`,
        current_spend_cap: currentSpendCap,
        real_amount_spent: realAmountSpent,
        max_withdrawable: Number(maxWithdrawable.toFixed(2)),
      }, 400);
    }

    const newSpendCap = Math.max(0.01, Number((currentSpendCap - withdrawAmount).toFixed(2)));

    const metaRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        spend_cap: String(newSpendCap),
        access_token: bmToken,
      }),
    });
    const metaData = await metaRes.json().catch(() => null);

    if (!metaRes.ok || metaData?.error) {
      const metaErrorMsg = metaData?.error?.message || `Meta HTTP ${metaRes.status}`;
      return json({ error: `Meta API error: ${metaErrorMsg}` }, 400);
    }

    const verifyRes = await metaFetch(`https://graph.facebook.com/v23.0/${actId}?fields=spend_cap&access_token=${encodeURIComponent(bmToken)}`, {
      method: "GET",
    });
    const verifyData = await verifyRes.json().catch(() => null);
    if (!verifyRes.ok || verifyData?.error) {
      const verifyErrorMsg = verifyData?.error?.message || `Meta verify HTTP ${verifyRes.status}`;
      return json({ error: `Meta verification failed: ${verifyErrorMsg}` }, 400);
    }

    const verifiedSpendCap = verifyData?.spend_cap !== undefined ? centsToDollars(Number(verifyData.spend_cap)) : null;
    if (verifiedSpendCap === null || Math.abs(verifiedSpendCap - newSpendCap) >= 0.02) {
      return json({ error: `Verification mismatch: expected $${newSpendCap}, got $${verifiedSpendCap ?? "unknown"}` }, 400);
    }

    await supabase.from("ad_accounts").update({
      spend_cap: newSpendCap,
      balance_after_topup: Number((newSpendCap - fallbackSpent).toFixed(2)),
    }).eq("id", ad_account_id);

    const { data: assignedRow } = await supabase.from("user_ad_accounts").select("user_id").eq("ad_account_id", ad_account_id).maybeSingle();
    let creditedWallet = false;
    let creditedUserId: string | null = assignedRow?.user_id ?? null;
    let newBalance: number | null = null;

    if (creditedUserId) {
      const { data: wallet } = await supabase.from("wallets").select("id, balance").eq("user_id", creditedUserId).single();
      if (wallet) {
        newBalance = Number(wallet.balance) + withdrawAmount;
        await supabase.from("wallets").update({ balance: newBalance }).eq("id", wallet.id);
        await supabase.from("transactions").insert({
          user_id: creditedUserId,
          amount: withdrawAmount,
          balance_after: newBalance,
          type: "refund",
          description: `Withdraw credit\n${account.account_name}\n${account.account_id.replace(/^act_/, "")}`,
          reference_id: ad_account_id,
          processed_by: isAdmin ? `admin:${userId}` : `client:${userId}`,
          via: lastMetaVia,
          source_ip: lastMetaIp,
        });
        creditedWallet = true;
      }
    }

    const bmDbId = account.business_manager_id;
    if (bmDbId) {
      await supabase.from("api_call_logs").insert({
        business_manager_id: bmDbId,
        function_name: "spend-cap-withdraw",
        call_count: 2,
      });
    }

    await supabase.from("system_logs").insert({
      user_id: userId,
      user_name: userName,
      action: "Withdraw",
      details: `${account.account_name} (${actId.replace(/^act_/, "")}) — $${withdrawAmount} withdrawn — Cap: $${currentSpendCap} → $${newSpendCap} — ${creditedWallet ? "Wallet credited" : "No client assigned"} [via=${lastMetaVia} IP: ${lastMetaIp ?? "n/a"}]`,
    });

    return json({
      success: true,
      old_spend_cap: currentSpendCap,
      new_spend_cap: newSpendCap,
      current_spend_cap: currentSpendCap,
      real_amount_spent: realAmountSpent,
      max_withdrawable: Number(maxWithdrawable.toFixed(2)),
      wallet_credited: creditedWallet,
      credited_user_id: creditedUserId,
      new_balance: newBalance,
      via: lastMetaVia,
      source_ip: lastMetaIp,
    });
  } catch (err) {
    console.error("spend-cap-withdraw error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
