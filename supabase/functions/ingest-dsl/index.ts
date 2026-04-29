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
  cards?: CardRow[];
};

type CardRow = {
  id: string;
  display_string?: string | null;
  type?: string | null;
  is_primary?: boolean;
  exp_month?: number | null;
  exp_year?: number | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function mergeCards(existing: CardRow[] = [], incoming: CardRow[] = []): CardRow[] {
  const byId = new Map<string, CardRow>();
  for (const card of [...existing, ...incoming]) {
    const id = String(card?.id ?? "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, {
      ...prev,
      ...card,
      id,
      display_string: card.display_string || prev?.display_string || `Card ...${id.slice(-4)}`,
      is_primary: !!(prev?.is_primary || card.is_primary),
    });
  }
  return Array.from(byId.values()).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
}

async function syncIncomingCards(supabase: any, accounts: any[], now: string) {
  const rows = accounts.filter((acc) => Array.isArray(acc.incoming_cards) && acc.incoming_cards.length > 0);
  if (!rows.length) return;

  const adAccountIds = rows.map((acc) => acc.id);
  const { data: snapshots } = await supabase
    .from("ad_account_last_known_state")
    .select("ad_account_id, cards")
    .in("ad_account_id", adAccountIds);
  const snapshotByAccount = new Map((snapshots ?? []).map((s: any) => [s.ad_account_id, Array.isArray(s.cards) ? s.cards : []]));

  const recentEvents: any[] = [];
  for (const idChunk of chunk(adAccountIds, 80)) {
    const { data } = await supabase
      .from("ad_account_card_assignments")
      .select("ad_account_id, funding_source_id, event_type, is_primary, detected_at")
      .in("ad_account_id", idChunk)
      .order("detected_at", { ascending: false });
    recentEvents.push(...(data ?? []));
  }
  const latestByKey = new Map<string, any>();
  for (const ev of recentEvents) {
    const key = `${ev.ad_account_id}:${ev.funding_source_id}`;
    if (!latestByKey.has(key)) latestByKey.set(key, ev);
  }

  const assignmentRows: any[] = [];
  const snapshotRows: any[] = [];
  const insightCardRows: any[] = [];

  for (const acc of rows) {
    const cards = mergeCards(snapshotByAccount.get(acc.id) as CardRow[] | undefined, acc.incoming_cards);
    if (!cards.length) continue;

    for (const card of cards) {
      await supabase.from("ad_account_cards").upsert({
        funding_source_id: card.id,
        bm_id: acc.business_manager_id ?? null,
        display_string: card.display_string || `Card ...${card.id.slice(-4)}`,
        card_type: card.type ?? null,
        exp_month: card.exp_month ?? null,
        exp_year: card.exp_year ?? null,
        last_seen_at: now,
        updated_at: now,
      }, { onConflict: "bm_id,funding_source_id", ignoreDuplicates: false });
    }

    const fsIds = cards.map((card) => card.id);
    const cardIdMap: Record<string, string> = {};
    if (fsIds.length && acc.business_manager_id) {
      const { data: vaultRows } = await supabase
        .from("ad_account_cards")
        .select("id, funding_source_id")
        .eq("bm_id", acc.business_manager_id)
        .in("funding_source_id", fsIds);
      for (const row of vaultRows ?? []) cardIdMap[row.funding_source_id] = row.id;
    }

    for (const card of cards) {
      const last = latestByKey.get(`${acc.id}:${card.id}`);
      if (!last || last.event_type === "detached") {
        assignmentRows.push({
          ad_account_id: acc.id,
          card_id: cardIdMap[card.id] ?? null,
          funding_source_id: card.id,
          display_string: card.display_string ?? null,
          event_type: "attached",
          is_primary: !!card.is_primary,
          detected_by: "extension",
          detected_at: now,
          metadata: card,
        });
      } else if (card.is_primary && !last.is_primary) {
        assignmentRows.push({
          ad_account_id: acc.id,
          card_id: cardIdMap[card.id] ?? null,
          funding_source_id: card.id,
          display_string: card.display_string ?? null,
          event_type: "became_primary",
          is_primary: true,
          detected_by: "extension",
          detected_at: now,
          metadata: card,
        });
      }
    }

    snapshotRows.push({ ad_account_id: acc.id, cards, last_synced_at: now, last_sync_error: null, last_sync_error_at: null });
    insightCardRows.push({ ad_account_id: acc.id, cards, updated_at: now });
  }

  for (const batch of chunk(assignmentRows, 50)) {
    if (batch.length) await supabase.from("ad_account_card_assignments").insert(batch);
  }
  for (const batch of chunk(snapshotRows, 50)) {
    if (batch.length) await supabase.from("ad_account_last_known_state").upsert(batch, { onConflict: "ad_account_id" });
  }
  for (const batch of chunk(insightCardRows, 50)) {
    if (batch.length) await supabase.from("ad_account_insights").upsert(batch, { onConflict: "ad_account_id" });
  }
}

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

    // Look up internal ad_account UUIDs. DB stores Meta accounts as
    // "act_<id>" but the extension sends bare "<id>". Query both forms.
    const bareIds = Array.from(incomingMap.keys());
    const prefixedIds = bareIds.map((k) => `act_${k}`);
    const existing: any[] = [];
    for (const idChunk of chunk([...bareIds, ...prefixedIds], 80)) {
      const { data, error: lookupErr } = await supabase
        .from("ad_accounts")
        .select("id, account_id, platform, business_manager_id")
        .in("account_id", idChunk);
      if (lookupErr) return json({ error: lookupErr.message }, 500);
      existing.push(...(data ?? []));
    }

    const now = new Date().toISOString();
    const updates: any[] = [];
    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const acc of existing ?? []) {
      const row = incomingMap.get(norm(acc.account_id));
      if (!row) continue;
      matched.push(acc.account_id);
      const incomingCards = mergeCards([], Array.isArray(row.cards) ? row.cards : []);
      updates.push({
        ad_account_id: acc.id,
        daily_spend_limit: row.daily_spend_limit,
        daily_spend_limit_currency: row.currency || "USD",
        daily_spend_limit_synced_at: now,
        updated_at: now,
      });
      (acc as any).incoming_cards = incomingCards;
    }

    const matchedSet = new Set(matched.map(norm));
    for (const k of incomingMap.keys()) {
      if (!matchedSet.has(k)) unmatched.push(k);
    }

    if (updates.length > 0) {
      for (const updateChunk of chunk(updates, 100)) {
        const { error: upsertErr } = await supabase
          .from("ad_account_insights")
          .upsert(updateChunk, { onConflict: "ad_account_id" });
        if (upsertErr) return json({ error: upsertErr.message }, 500);
      }
    }

    await syncIncomingCards(supabase, existing, now);

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