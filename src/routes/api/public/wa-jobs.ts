// Public endpoint used by the "CRM Top-Up Helper" browser extension to send
// queued WhatsApp messages through WhatsApp Web. Every call must carry the
// long-lived Auto-pilot token minted from the dashboard (scope: "autopilot").
import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

const MAX_ATTEMPTS = 3;

function normalizePhone(raw: string, defaultCc: string): string {
  let d = String(raw ?? "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  // local Bangladeshi style: 01XXXXXXXXX -> 8801XXXXXXXXX
  if (d.startsWith("0")) d = defaultCc + d.slice(1);
  else if (d.length <= 10) d = defaultCc + d;
  return d;
}

export const Route = createFileRoute("/api/public/wa-jobs")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        const { verifyCrmTokenDetailed } = await import("@/lib/crmToken.server");
        const { payload, reason } = verifyCrmTokenDetailed(String(body?.token ?? ""));
        if (!payload || payload.scope !== "autopilot") {
          const msg =
            reason === "expired"
              ? "Token expired — take a new Auto-pilot token from the dashboard"
              : reason === "no_secret"
                ? "Server not configured (CRM_JOB_SECRET missing)"
                : "Invalid token — reopen from the dashboard";
          return json({ ok: false, error: msg, reason }, 401);
        }

        const action = String(body?.action ?? "");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const defaultCc = process.env["WHATSAPP_DEFAULT_COUNTRY_CODE"] || "880";

        async function settings() {
          const { data } = await supabaseAdmin
            .from("wa_notify_settings" as any)
            .select("key, enabled, num_value");
          const map = new Map<string, any>((data ?? []).map((r: any) => [r.key, r]));
          return {
            gapSeconds: Number(map.get("gap_seconds")?.num_value ?? 45),
            dailyLimit: Number(map.get("daily_limit")?.num_value ?? 150),
          };
        }

        // Release messages stuck in "sending" (browser closed mid-send).
        async function releaseStale() {
          const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          await supabaseAdmin
            .from("wa_messages" as any)
            .update({ status: "pending", claimed_at: null, claimed_by: null })
            .eq("status", "sending")
            .lt("claimed_at", staleBefore);
        }

        if (action === "list_pending") {
          await releaseStale();
          const { data, error } = await supabaseAdmin
            .from("wa_messages" as any)
            .select("id, phone, body, attempts, created_at")
            .eq("status", "pending")
            .lt("attempts", MAX_ATTEMPTS)
            .order("created_at", { ascending: true })
            .limit(10);
          if (error) return json({ ok: false, error: error.message }, 400);
          const items = (data ?? []).map((r: any) => ({
            id: r.id,
            phone: normalizePhone(r.phone, defaultCc),
            body: r.body,
          }));
          return json({ ok: true, items });
        }

        if (action === "claim") {
          const id = String(body?.id ?? "");
          if (!id) return json({ ok: false, error: "id is required" }, 400);
          await releaseStale();
          const { gapSeconds, dailyLimit } = await settings();

          // Daily cap (UTC day) — protects the number from being flagged.
          const dayStart = new Date();
          dayStart.setUTCHours(0, 0, 0, 0);
          const { count: sentToday } = await supabaseAdmin
            .from("wa_messages" as any)
            .select("id", { count: "exact", head: true })
            .eq("status", "sent")
            .gte("sent_at", dayStart.toISOString());
          if ((sentToday ?? 0) >= dailyLimit) {
            return json({ ok: false, error: "Daily limit reached", reason: "limit" }, 409);
          }

          // Spacing: never two sends closer than gapSeconds, on any PC.
          const gapBefore = new Date(Date.now() - gapSeconds * 1000).toISOString();
          const { data: recent } = await supabaseAdmin
            .from("wa_messages" as any)
            .select("id")
            .or(`sent_at.gte.${gapBefore},and(status.eq.sending,claimed_at.gte.${gapBefore})`)
            .limit(1);
          if (recent && recent.length > 0) {
            return json({ ok: false, error: "Too soon — waiting for the gap", reason: "busy" }, 409);
          }

          const now = new Date().toISOString();
          const { data: current } = await supabaseAdmin
            .from("wa_messages" as any)
            .select("attempts")
            .eq("id", id)
            .maybeSingle();

          const { data: claimed, error: claimErr } = await supabaseAdmin
            .from("wa_messages" as any)
            .update({
              status: "sending",
              claimed_at: now,
              claimed_by: String(body?.client ?? "helper").slice(0, 60),
              attempts: Number((current as any)?.attempts ?? 0) + 1,
            })
            .eq("id", id)
            .eq("status", "pending")
            .select("id, phone, body")
            .maybeSingle();
          if (claimErr) return json({ ok: false, error: claimErr.message }, 400);
          if (!claimed) return json({ ok: false, error: "Already claimed", reason: "claimed" }, 409);

          return json({
            ok: true,
            id: (claimed as any).id,
            phone: normalizePhone((claimed as any).phone, defaultCc),
            body: (claimed as any).body,
          });
        }

        if (action === "result") {
          const id = String(body?.id ?? "");
          if (!id) return json({ ok: false, error: "id is required" }, 400);
          const now = new Date().toISOString();

          if (body?.success) {
            const { error } = await supabaseAdmin
              .from("wa_messages" as any)
              .update({ status: "sent", sent_at: now, last_error: null })
              .eq("id", id);
            if (error) return json({ ok: false, error: error.message }, 400);
            return json({ ok: true });
          }

          const { data: row } = await supabaseAdmin
            .from("wa_messages" as any)
            .select("attempts")
            .eq("id", id)
            .maybeSingle();
          const attempts = Number((row as any)?.attempts ?? 0);
          const { error } = await supabaseAdmin
            .from("wa_messages" as any)
            .update({
              status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
              claimed_at: null,
              claimed_by: null,
              last_error: String(body?.error ?? "Send failed").slice(0, 500),
            })
            .eq("id", id);
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true, retrying: attempts < MAX_ATTEMPTS });
        }

        return json({ ok: false, error: "Unknown action" }, 400);
      },
    },
  },
});
