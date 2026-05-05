import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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
    if (claimsError || !claimsData?.claims) return json({ error: "Invalid token" }, 401);
    const userId = claimsData.claims.sub;

    const body = await req.json().catch(() => ({}));
    const adAccountId: string = body.ad_account_id;
    if (!adAccountId) return json({ error: "ad_account_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify user owns or admins this account
    const { data: account } = await supabase
      .from("ad_accounts")
      .select("id, account_id, account_name, user_id, platform")
      .eq("id", adAccountId)
      .maybeSingle();
    if (!account) return json({ error: "Ad account not found" }, 404);

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    const isAdmin = roleSet.has("admin") || roleSet.has("superadmin");
    if (!isAdmin && account.user_id !== userId) {
      return json({ error: "Forbidden" }, 403);
    }

    if (account.platform !== "meta") {
      return json({ error: "Only Meta accounts support sync requests" }, 400);
    }

    // Reuse existing pending row if present (avoid spam)
    const { data: existing } = await supabase
      .from("ad_account_sync_requests")
      .select("id, status, requested_at")
      .eq("ad_account_id", adAccountId)
      .eq("status", "pending")
      .maybeSingle();

    let requestId = existing?.id;
    if (!existing) {
      const { data: inserted, error: insErr } = await supabase
        .from("ad_account_sync_requests")
        .insert({ ad_account_id: adAccountId, requested_by: userId })
        .select("id")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);
      requestId = inserted.id;
    }

    // Notify admins via in-app notifications
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "superadmin"]);
    const adminIds = Array.from(new Set((adminRoles ?? []).map((r: any) => r.user_id)));
    if (adminIds.length && !existing) {
      const { data: requesterProfile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", userId)
        .maybeSingle();
      const requesterName = requesterProfile?.full_name || requesterProfile?.email || "A client";
      await supabase.from("notifications").insert(
        adminIds.map((aid) => ({
          user_id: aid,
          type: "ad_account_sync_request",
          title: "Billing sync requested",
          message: `${requesterName} requested billing sync for ${account.account_name || account.account_id}`,
          reference_id: adAccountId,
        })),
      );
    }

    // Telegram ping (best-effort)
    if (!existing) {
      try {
        const [{ data: tokenRow }, { data: groupRow }] = await Promise.all([
          supabase.from("site_settings").select("value").eq("key", "telegram_bot_token").maybeSingle(),
          supabase.from("site_settings").select("value").eq("key", "telegram_forward_group_id").maybeSingle(),
        ]);
        if (tokenRow?.value && groupRow?.value) {
          const text = `🔄 <b>Billing sync requested</b>\nAccount: <code>${account.account_name || account.account_id}</code>\nMeta ID: <code>${account.account_id}</code>`;
          await fetch(`https://api.telegram.org/bot${tokenRow.value}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: groupRow.value, text, parse_mode: "HTML" }),
          });
        }
      } catch (e) {
        console.warn("telegram notify failed", e);
      }
    }

    return json({ ok: true, request_id: requestId, reused: !!existing });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
