import { createFileRoute } from "@tanstack/react-router";

const JOB_NAME = "ads-agent-tasks";

/** Every minute (pg_cron): runs due AI Ads Agent tasks — scheduled plans and unfinished bulk jobs. */
export const Route = createFileRoute("/api/public/ads-agent-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin: any = supabaseAdmin;
        const provided = request.headers.get("x-job-secret") || "";
        const { data: row } = await admin.from("internal_job_secrets").select("secret").eq("job_name", JOB_NAME).maybeSingle();
        const expected = String(row?.secret ?? "");
        if (!expected || provided.length !== expected.length || provided !== expected) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { processTask } = await import("@/lib/adsAgent.server");
        const origin = new URL(request.url).origin;
        const nowIso = new Date().toISOString();
        const { data: due } = await admin.from("ads_agent_tasks").select("id")
          .in("status", ["scheduled", "running"]).lte("run_at", nowIso)
          .or(`locked_until.is.null,locked_until.lt."${nowIso}"`)
          .order("run_at", { ascending: true }).limit(5);
        const started = Date.now();
        const results: any[] = [];
        for (const t of due ?? []) {
          const left = 50_000 - (Date.now() - started);
          if (left < 8_000) break;
          try {
            const after = await processTask(admin, origin, t.id, Math.min(left - 5_000, 40_000));
            results.push({ id: t.id, status: after?.status });
          } catch (e: any) {
            results.push({ id: t.id, error: e?.message });
          }
        }
        return Response.json({ ok: true, ran: results.length, results });
      },
    },
  },
});
