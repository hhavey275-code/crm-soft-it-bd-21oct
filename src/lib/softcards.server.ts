// Server-only SoftCards deposit sync logic, shared by the public webhook route
// and the authenticated admin server functions.
const CALLBACK_URL = "https://cards.softitbd.com/api/public/webhooks/deposit-approval";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export function depositSecret(): string {
  return (process.env.DEPOSIT_SYNC_SECRET ?? "").trim();
}

export function secretMatches(given: string | null): boolean {
  const s = depositSecret();
  if (!s || !given) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(s);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Send approve/reject to SoftCards. On failure the row stays pending with the
 *  intended action queued so it can be retried. */
export async function sendDecision(
  depositId: string,
  action: "approve" | "reject",
  note: string | null,
  meta: { by?: string | null; via: "manual" | "auto" | "retry" },
) {
  const db = await admin();
  const { data: row } = await db.from("softcard_topups").select("*").eq("deposit_id", depositId).maybeSingle();
  if (!row) throw new Error("Request not found");
  if (row.status !== "pending") throw new Error("Already " + row.status);

  const body: Record<string, string> = { deposit_id: depositId, action };
  if (action === "reject") body.note = note || "";

  let ok = false;
  let httpStatus: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(CALLBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-deposit-sync-secret": depositSecret() },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    ok = res.ok;
    if (!ok) error = (await res.text().catch(() => "")).slice(0, 500) || `HTTP ${res.status}`;
  } catch (e: any) {
    error = String(e?.message ?? e).slice(0, 500);
  }

  await db.from("softcard_callback_log").insert({ deposit_id: depositId, action, ok, http_status: httpStatus, error });

  const now = new Date().toISOString();
  if (ok) {
    await db.from("softcard_topups").update({
      status: action === "approve" ? "approved" : "rejected",
      pending_action: null, pending_note: action === "reject" ? note : null,
      decided_by: meta.by ?? row.decided_by ?? null,
      decided_via: meta.via === "retry" ? row.decided_via : meta.via,
      callback_attempts: row.callback_attempts + 1, last_callback_error: null, updated_at: now,
    }).eq("id", row.id);
  } else {
    await db.from("softcard_topups").update({
      pending_action: action, pending_note: note,
      decided_by: meta.by ?? row.decided_by ?? null,
      decided_via: meta.via === "retry" ? row.decided_via : meta.via,
      callback_attempts: row.callback_attempts + 1, last_callback_error: error, updated_at: now,
    }).eq("id", row.id);
  }
  return { ok, error };
}

/** Same rule as the CRM's SMS auto-approval: a bank/bKash SMS that arrived
 *  around the request time must contain the reference and the local amount. */
export async function tryAutoMatch(row: any): Promise<boolean> {
  if (row.status !== "pending" || row.pending_action) return false;
  const ref = String(row.reference ?? "").trim().toLowerCase();
  const local = Number(row.local_amount_minor ?? 0) / 100;
  if (ref.length < 4 || !(local > 0)) return false;
  const db = await admin();
  const t = new Date(row.source_created_at ?? row.created_at).getTime();
  const { data: msgs } = await db.from("telegram_messages")
    .select("text, raw_update, update_id, matched_request_id")
    .gte("created_at", new Date(t - 120 * 60000).toISOString())
    .lte("created_at", new Date(Math.max(t + 30 * 60000, Date.now())).toISOString())
    .is("matched_request_id", null).limit(200);
  for (const m of msgs ?? []) {
    const p = m.raw_update?.message || m.raw_update?.channel_post || {};
    const text = String(m.text || p.text || p.caption || "");
    if (!text.toLowerCase().includes(ref)) continue;
    const nums = (text.match(/[\d,]+(?:\.\d+)?/g) || []).map((n) => Number(n.replace(/,/g, "")));
    if (!nums.some((n) => Math.abs(n - local) <= 1)) continue;
    const { data: used } = await db.from("softcard_topups").select("id").eq("matched_update_id", m.update_id).neq("id", row.id).limit(1);
    if (used?.length) continue;
    await db.from("softcard_topups").update({ matched_update_id: m.update_id }).eq("id", row.id);
    await sendDecision(row.deposit_id, "approve", null, { via: "auto" });
    return true;
  }
  return false;
}

/** Retry failed callbacks and run auto-matching on pending rows. */
export async function sweepPending() {
  const db = await admin();
  const { data: rows } = await db.from("softcard_topups").select("*").eq("status", "pending").order("created_at").limit(50);
  let retried = 0, matched = 0;
  for (const r of rows ?? []) {
    try {
      if (r.pending_action) {
        await sendDecision(r.deposit_id, r.pending_action, r.pending_note, { via: "retry" });
        retried++;
      } else if (await tryAutoMatch(r)) matched++;
    } catch (e) {
      console.error("[softcards sweep]", r.deposit_id, e);
    }
  }
  return { retried, matched };
}
