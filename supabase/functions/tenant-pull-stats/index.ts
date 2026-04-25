// Master → Tenant stats pull. Called from master TenantDetailPage on demand.
// Looks up the tenant's webhook_url + api_key, hits its tenant-webhook
// `pull_stats` action, then caches the response into tenants + snapshots.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Auth: caller must be an admin/superadmin
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "").trim();
  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "superadmin");
  if (!isAdmin) return json({ error: "Forbidden" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const tenantId = body.tenant_id as string;
  if (!tenantId) return json({ error: "tenant_id required" }, 400);

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .maybeSingle();
  if (tErr || !tenant) return json({ error: "Tenant not found" }, 404);

  // Tenant webhook URL: derive from tenant.domain (e.g. https://app.acme.com)
  // We need the tenant's Supabase URL. Stored in tenants.webhook_url ideally,
  // else fall back to tenants.supabase_url, else error.
  const webhookBase: string =
    (tenant as any).webhook_url ||
    (tenant as any).supabase_url ||
    "";
  if (!webhookBase) {
    return json({
      error: "Tenant has no webhook_url configured. Set tenants.webhook_url to the tenant's Supabase URL (e.g. https://xxxx.supabase.co)."
    }, 400);
  }

  // Tenant key: master needs to know the tenant's tenant-webhook key.
  // We store this as tenants.pull_api_key (separate from the inbound api_key
  // tenant uses to call us).
  const pullKey: string =
    (tenant as any).pull_api_key ||
    (tenant as any).api_key || // fallback: same key
    "";
  if (!pullKey) return json({ error: "Tenant pull_api_key not configured" }, 400);

  const url = `${webhookBase.replace(/\/+$/, "")}/functions/v1/tenant-webhook`;

  let pullJson: any;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Key": pullKey,
      },
      body: JSON.stringify({ action: "pull_stats" }),
    });
    pullJson = await res.json().catch(() => ({}));
    if (!res.ok || !pullJson?.ok) {
      return json({
        error: pullJson?.error || `Tenant returned HTTP ${res.status}`,
        tenant_url: url,
      }, 502);
    }
  } catch (e: any) {
    return json({ error: `Failed to reach tenant: ${e?.message ?? e}`, tenant_url: url }, 502);
  }

  const stats = pullJson.stats ?? {};
  const num = (v: any) => Number(v ?? 0) || 0;
  const int = (v: any) => Math.trunc(Number(v ?? 0)) || 0;

  const cache = {
    stats_updated_at: new Date().toISOString(),
    stats_accounts_total: int(stats.accounts_total),
    stats_accounts_active: int(stats.accounts_active),
    stats_accounts_disabled: int(stats.accounts_disabled),
    stats_accounts_inactive: int(stats.accounts_inactive),
    stats_spend_today: num(stats.spend_today),
    stats_spend_yesterday: num(stats.spend_yesterday),
    stats_spend_month: num(stats.spend_this_month),
    stats_spend_lifetime: num(stats.spend_lifetime),
    stats_orders_today: int(stats.orders_today),
    stats_orders_yesterday: int(stats.orders_yesterday),
    stats_total_wallet: num(stats.total_wallet_balance),
    stats_total_clients: int(stats.total_clients),
    stats_topups_today_count: int(stats.topups_today_count),
    stats_topups_today_amount: num(stats.topups_today_amount),
    stats_topups_pending: int(stats.topups_pending),
    stats_top_accounts: Array.isArray(stats.top_accounts) ? stats.top_accounts.slice(0, 100) : [],
  };

  await supabase.from("tenants").update(cache).eq("id", tenant.id);

  // Append a snapshot for history graph
  try {
    await supabase.from("tenant_stats_snapshots").insert({
      tenant_id: tenant.id,
      accounts_total: cache.stats_accounts_total,
      accounts_active: cache.stats_accounts_active,
      accounts_disabled: cache.stats_accounts_disabled,
      accounts_inactive: cache.stats_accounts_inactive,
      spend_today: cache.stats_spend_today,
      spend_yesterday: cache.stats_spend_yesterday,
      spend_this_month: cache.stats_spend_month,
      spend_lifetime: cache.stats_spend_lifetime,
      orders_today: cache.stats_orders_today,
      orders_yesterday: cache.stats_orders_yesterday,
      total_wallet_balance: cache.stats_total_wallet,
      total_clients: cache.stats_total_clients,
      topups_today_count: cache.stats_topups_today_count,
      topups_today_amount: cache.stats_topups_today_amount,
      topups_pending_count: cache.stats_topups_pending,
      raw: stats,
    } as any);
  } catch (snapErr) {
    console.warn("snapshot insert failed:", (snapErr as any)?.message);
  }

  return json({ ok: true, stats, cached_at: cache.stats_updated_at });
});