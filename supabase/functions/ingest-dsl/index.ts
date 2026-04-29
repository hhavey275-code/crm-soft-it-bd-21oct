import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type DslRow = {
  account_id: string; // Meta account id, with or without "act_" prefix
  daily_spend_limit: number; // in account currency, full units (USD, not cents)
  currency?: string;
};

Deno.serve(async (req: Request) => {
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Only admins/superadmins can ingest DSL — they're the ones with full Facebook access.
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    if (!roleSet.has("admin") && !roleSet.has("superadmin")) {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const rows: DslRow[] = Array.isArray(body?.accounts) ? body.accounts : [];
    if (rows.length === 0) return json({ error: "No accounts provided" }, 400);

    // Normalize incoming account_ids and build a map: normalized -> row
    const norm = (s: string) => String(s || "").replace(/^act_/, "").trim();
    const incomingMap = new Map<string, DslRow>();
    for (const r of rows) {
      if (!r?.account_id) continue;
      const key = norm(r.account_id);
      if (!key) continue;
      const limit = Number(r.daily_spend_limit);
      if (!Number.isFinite(limit) || limit < 0) continue;
      incomingMap.set(key, { ...r, account_id: key, daily_spend_limit: limit });
    }

    if (incomingMap.size === 0) return json({ error: "No valid accounts" }, 400);

    // Look up our internal ad_account UUIDs for the given Meta account_ids
    const accountIds = Array.from(incomingMap.keys());
    const { data: existing, error: lookupErr } = await supabase
      .from("ad_accounts")
      .select("id, account_id")
      .in("account_id", accountIds);
    if (lookupErr) return json({ error: lookupErr.message }, 500);

    const now = new Date().toISOString();
    const updates: any[] = [];
    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const acc of existing ?? []) {
      const row = incomingMap.get(norm(acc.account_id));
      if (!row) continue;
      matched.push(acc.account_id);
      updates.push({
        ad_account_id: acc.id,
        daily_spend_limit: row.daily_spend_limit,
        daily_spend_limit_currency: row.currency || "USD",
        daily_spend_limit_synced_at: now,
        updated_at: now,
      });
    }

    const matchedSet = new Set(matched.map(norm));
    for (const k of incomingMap.keys()) {
      if (!matchedSet.has(k)) unmatched.push(k);
    }

    if (updates.length > 0) {
      const { error: upsertErr } = await supabase
        .from("ad_account_insights")
        .upsert(updates, { onConflict: "ad_account_id" });
      if (upsertErr) return json({ error: upsertErr.message }, 500);
    }

    return json({
      ok: true,
      received: rows.length,
      saved: updates.length,
      matched,
      unmatched,
      synced_at: now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});