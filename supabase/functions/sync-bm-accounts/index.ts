import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};

const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";

async function metaFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!url.startsWith("https://graph.facebook.com/")) return fetch(url, options);
  const proxySecret = Deno.env.get("META_PROXY_SECRET");
  const proxyUrl = Deno.env.get("META_PROXY_URL") || DEFAULT_META_PROXY_URL;
  if (proxySecret && proxyUrl) {
    try {
      const headers = new Headers(options.headers ?? {});
      const contentType = headers.get("Content-Type") ?? headers.get("content-type") ?? undefined;
      const method = options.method ?? "GET";
      const body = options.body instanceof URLSearchParams
        ? options.body.toString()
        : typeof options.body === "string" ? options.body : undefined;
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-proxy-secret": proxySecret },
        body: JSON.stringify({ url, method, body, contentType })
      });
      const text = await proxyRes.text();
      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");
      let isProxyOwnError = false;
      if (proxyRes.status >= 500 && proxyRes.status < 600 && trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.error === "string") {
            isProxyOwnError = true;
            console.warn("Proxy returned own error, falling back:", parsed.error);
          }
        } catch {}
      }
      if (!looksLikeHtml && !isProxyOwnError) {
        return new Response(text, { status: proxyRes.status, headers: proxyRes.headers });
      }
      if (looksLikeHtml) console.warn("Proxy returned HTML, falling back to direct Meta API call");
    } catch (proxyErr) {
      console.warn("Proxy failed, falling back to direct call:", proxyErr);
    }
  }
  return fetch(url, options);
}

async function decryptToken(stored: string, secret: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("bm-token-enc-v1"), iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch {
    return stored;
  }
}

async function fetchAllPages(url: string): Promise<any[]> {
  const results: any[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await metaFetch(nextUrl);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    results.push(...(data.data ?? []));
    nextUrl = data.paging?.next ?? null;
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "superadmin"])
      .limit(1);
    const isAdmin = roleData && roleData.length > 0;
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }

    const { business_manager_id, include_unassigned } = await req.json();
    if (!business_manager_id) {
      return new Response(JSON.stringify({ error: "business_manager_id required" }), { status: 400, headers: corsHeaders });
    }

    const { data: bm, error: bmError } = await supabase
      .from("business_managers")
      .select("*")
      .eq("id", business_manager_id)
      .single();
    if (bmError || !bm) {
      return new Response(JSON.stringify({ error: "Business Manager not found" }), { status: 404, headers: corsHeaders });
    }
    if (!/^\d+$/.test(bm.bm_id)) {
      return new Response(JSON.stringify({
        error: `Invalid BM ID "${bm.bm_id}" — must be a numeric Meta Business Manager ID.`
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Include assigned_users so we can filter to System-User-assigned accounts only.
    const fields = "id,name,account_id,account_status,spend_cap,amount_spent,business_name,assigned_users.limit(250){id,role}";
    const baseUrl = `https://graph.facebook.com/v23.0/${bm.bm_id}`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bmAccessToken = await decryptToken(bm.access_token, serviceKey);

    // Resolve the System User ID owning this token via /me
    let systemUserId: string | null = null;
    try {
      const meRes = await metaFetch(`https://graph.facebook.com/v23.0/me?fields=id&access_token=${bmAccessToken}`);
      const meJson = await meRes.json();
      if (meJson?.id) systemUserId = String(meJson.id);
      else console.warn("Could not resolve /me id:", meJson);
    } catch (e) {
      console.warn("Failed to resolve token's /me id:", e);
    }

    const [ownedResult, clientResult] = await Promise.allSettled([
      fetchAllPages(`${baseUrl}/owned_ad_accounts?fields=${encodeURIComponent(fields)}&access_token=${bmAccessToken}&limit=100`),
      fetchAllPages(`${baseUrl}/client_ad_accounts?fields=${encodeURIComponent(fields)}&access_token=${bmAccessToken}&limit=100`)
    ]);
    const ownedAccounts = ownedResult.status === "fulfilled" ? ownedResult.value : [];
    const clientAccounts = clientResult.status === "fulfilled" ? clientResult.value : [];
    if (ownedResult.status === "rejected") console.error("owned_ad_accounts:", ownedResult.reason);
    if (clientResult.status === "rejected") console.error("client_ad_accounts:", clientResult.reason);

    if (ownedAccounts.length === 0 && clientAccounts.length === 0) {
      await supabase.from("sync_logs").insert({
        business_manager_id: bm.id,
        synced_count: 0,
        total_count: 0,
        status: "error",
        error_message: "No accounts returned from owned or client endpoints"
      });
      return new Response(JSON.stringify({ error: "No ad accounts found from Meta API" }), { status: 400, headers: corsHeaders });
    }

    // Dedupe
    const accountMap = new Map<string, any>();
    for (const account of [...ownedAccounts, ...clientAccounts]) {
      const accountId = account.account_id || account.id?.replace("act_", "");
      if (accountId && !accountMap.has(accountId)) accountMap.set(accountId, account);
    }
    const allAccounts = Array.from(accountMap.values());

    // Filter: keep accounts where the System User behind this token is assigned.
    // If we couldn't resolve systemUserId or caller passes include_unassigned=true, skip filtering.
    const totalBeforeFilter = allAccounts.length;
    let filteredAccounts = allAccounts;
    let skippedUnassigned = 0;
    if (systemUserId && !include_unassigned) {
      filteredAccounts = allAccounts.filter((acc) => {
        const assigned = acc.assigned_users?.data ?? [];
        return assigned.some((u: any) => String(u.id) === systemUserId);
      });
      skippedUnassigned = totalBeforeFilter - filteredAccounts.length;
    }

    const rows = filteredAccounts.map((account) => {
      const accountId = account.account_id || account.id?.replace("act_", "");
      return {
        account_id: `act_${accountId}`,
        account_name: account.name || `Ad Account ${accountId}`,
        business_manager_id: bm.id,
        business_name: account.business_name || null,
        status: account.account_status === 1 ? "active" : account.account_status === 2 ? "disabled" : "pending",
        spend_cap: Number(account.spend_cap ?? 0) / 100,
        amount_spent: Number(account.amount_spent ?? 0) / 100
      };
    });

    // ============================================================
    // Auto-apply pending invitation permissions
    // For each pending invitation on this BM, check if invitee has accepted
    // (i.e., now appears in BM business_users). If yes, apply stored
    // ad-account permissions and mark invitation as permissions_applied.
    // ============================================================
    let invitesApplied = 0;
    let invitesAccepted = 0;
    const inviteErrors: string[] = [];
    try {
      const { data: pendingInvites } = await supabase
        .from("bm_invitations")
        .select("*")
        .eq("business_manager_id", bm.id)
        .in("status", ["pending", "accepted"]);

      if (pendingInvites && pendingInvites.length > 0) {
        // Fetch current BM business users (accepted members) and pending invites from Meta
        const [bmUsersRes, bmPendingRes] = await Promise.allSettled([
          fetchAllPages(`${baseUrl}/business_users?fields=id,email,name,role&access_token=${bmAccessToken}&limit=200`),
          fetchAllPages(`${baseUrl}/pending_users?fields=id,email,role&access_token=${bmAccessToken}&limit=200`)
        ]);
        const bmUsers = bmUsersRes.status === "fulfilled" ? bmUsersRes.value : [];
        const bmPending = bmPendingRes.status === "fulfilled" ? bmPendingRes.value : [];
        const acceptedByEmail = new Map<string, any>();
        for (const u of bmUsers) {
          if (u.email) acceptedByEmail.set(String(u.email).toLowerCase(), u);
        }
        const pendingEmails = new Set<string>(
          bmPending.map((u: any) => String(u.email || "").toLowerCase()).filter(Boolean)
        );

        for (const invite of pendingInvites) {
          const emailKey = String(invite.email).toLowerCase();
          const acceptedUser = acceptedByEmail.get(emailKey);

          if (!acceptedUser) {
            // If no longer in pending list and not accepted, mark expired
            if (invite.status === "pending" && !pendingEmails.has(emailKey)) {
              await supabase.from("bm_invitations")
                .update({ status: "expired" })
                .eq("id", invite.id);
            }
            continue;
          }

          // User accepted. Mark accepted if still pending.
          if (invite.status === "pending") {
            await supabase.from("bm_invitations")
              .update({ status: "accepted", accepted_at: now, meta_user_id: String(acceptedUser.id) })
              .eq("id", invite.id);
            invitesAccepted++;
          }

          const perms = invite.ad_account_permissions as any;
          if (!perms || !Array.isArray(perms.accounts) || perms.accounts.length === 0) {
            // Nothing to apply — mark applied
            await supabase.from("bm_invitations")
              .update({ status: "permissions_applied", permissions_applied_at: now })
              .eq("id", invite.id);
            continue;
          }

          // Apply each ad account permission via Meta API
          let allOk = true;
          const errs: string[] = [];
          for (const acc of perms.accounts) {
            const adAccountId = String(acc.account_id || "").replace(/^act_/, "");
            const tasks: string[] = Array.isArray(acc.tasks) ? acc.tasks : [];
            if (!adAccountId || tasks.length === 0) continue;
            try {
              const assignUrl = `https://graph.facebook.com/v23.0/act_${adAccountId}/assigned_users`;
              const body = new URLSearchParams({
                user: String(acceptedUser.id),
                tasks: tasks.join(","),
                access_token: bmAccessToken,
              });
              const r = await metaFetch(assignUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
              });
              const j = await r.json();
              if (j.error) {
                allOk = false;
                errs.push(`act_${adAccountId}: ${j.error.message}`);
              }
            } catch (e) {
              allOk = false;
              errs.push(`act_${adAccountId}: ${e instanceof Error ? e.message : "unknown"}`);
            }
          }

          await supabase.from("bm_invitations")
            .update({
              status: allOk ? "permissions_applied" : "accepted",
              permissions_applied_at: allOk ? now : null,
              error_message: errs.length > 0 ? errs.join("; ") : null,
            })
            .eq("id", invite.id);

          if (allOk) invitesApplied++;
          else inviteErrors.push(`${invite.email}: ${errs.join("; ")}`);
        }
      }
    } catch (e) {
      console.error("Auto-apply invitation permissions failed:", e);
      inviteErrors.push(e instanceof Error ? e.message : "unknown");
    }

    await Promise.all([
      supabase.from("business_managers").update({ last_synced_at: now, status: "active" }).eq("id", bm.id),
      supabase.from("sync_logs").insert({
        business_manager_id: bm.id,
        synced_count: rows.length,
        total_count: totalBeforeFilter,
        status: "success",
        error_message: skippedUnassigned > 0
          ? `Filtered to System User assigned accounts; skipped ${skippedUnassigned} unassigned`
          : null
      })
    ]);

    return new Response(JSON.stringify({
      success: true,
      accounts: rows,
      total: totalBeforeFilter,
      filtered: rows.length,
      skipped_unassigned: skippedUnassigned,
      system_user_id: systemUserId,
      owned: ownedAccounts.length,
      client: clientAccounts.length,
      last_synced_at: now
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("sync-bm-accounts error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error"
    }), { status: 500, headers: corsHeaders });
  }
});
