import { createFileRoute } from "@tanstack/react-router";

/**
 * AI Ads Agent (chat + voice) for My Ads. Claude only reads data and proposes plans here;
 * confirmed plans become ads_agent_tasks rows whose steps run through /api/managed-ads as the
 * client (same ownership + wallet checks), right away or on their schedule.
 */

// Same login check as /api/managed-ads (project URL + public anon key work on every host).
async function verifyUser(token: string): Promise<string | null> {
  if (!token) return null;
  const url = "https://dhswrfzdqcavgmymllat.supabase.co";
  const keys = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s",
    process.env.SUPABASE_PUBLISHABLE_KEY,
  ].filter(Boolean) as string[];
  for (const key of keys) {
    try {
      const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      if (r.ok) { const u: any = await r.json().catch(() => null); if (u?.id) return String(u.id); }
    } catch { /* next */ }
  }
  return null;
}

const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export const Route = createFileRoute("/api/ads-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") || "";
          const userId = auth.startsWith("Bearer ") ? await verifyUser(auth.slice(7).trim()) : null;
          if (!userId) return json({ error: "লগইন যাচাই হয়নি — একবার Sign out করে আবার লগইন করুন" }, 401);
          const body: any = await request.json().catch(() => null);
          if (!body || typeof body.action !== "string") return json({ error: "ভুল তথ্য পাঠানো হয়েছে" }, 400);
          const origin = new URL(request.url).origin;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const agent = await import("@/lib/adsAgent.server");
          const admin: any = supabaseAdmin;
          const asUserId = uuid(body.asUserId) && body.asUserId !== userId ? String(body.asUserId) : undefined;

          if (body.action === "chat") {
            const history = Array.isArray(body.messages) ? body.messages.filter((m: any) => m && (m.role === "user" || m.role === "assistant")) : [];
            if (!history.length || history[history.length - 1].role !== "user") return json({ error: "মেসেজ খালি" }, 400);
            const out = await agent.agentChat(admin, { origin, userId, asUserId }, history, typeof body.selectedAccount === "string" ? body.selectedAccount.slice(0, 200) : undefined);
            return json(out);
          }

          if (body.action === "confirm") {
            // Re-validate the plan on the server; the steps are rebuilt here, never taken from the browser as-is.
            const plan = agent.normalizePlan(body.plan);
            const task = await agent.createTask(admin, userId, plan, asUserId);
            return json({ task });
          }

          if (body.action === "run") {
            if (!uuid(body.id)) return json({ error: "ভুল কাজ" }, 400);
            const { data: own } = await admin.from("ads_agent_tasks").select("id").eq("id", body.id).eq("user_id", userId).maybeSingle();
            if (!own) return json({ error: "এই কাজ আপনার নয়" }, 404);
            const task = await agent.processTask(admin, origin, body.id, 40_000);
            return json({ task });
          }

          if (body.action === "tasks") {
            const { data } = await admin.from("ads_agent_tasks").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
            return json({ tasks: data ?? [] });
          }

          if (body.action === "cancel") {
            if (!uuid(body.id)) return json({ error: "ভুল কাজ" }, 400);
            const { data } = await admin.from("ads_agent_tasks").update({ status: "cancelled", updated_at: new Date().toISOString() })
              .eq("id", body.id).eq("user_id", userId).in("status", ["scheduled", "running"]).select("*").maybeSingle();
            if (!data) return json({ error: "এই কাজ আর বাতিল করা যাবে না" }, 400);
            return json({ task: data });
          }

          return json({ error: "অজানা কাজ" }, 400);
        } catch (e: any) {
          console.error("[ads-agent]", e);
          return json({ error: e?.message || "কিছু একটা ভুল হয়েছে" }, 400);
        }
      },
    },
  },
});
