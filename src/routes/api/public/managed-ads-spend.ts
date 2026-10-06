import { createFileRoute } from "@tanstack/react-router";
import { syncClientSpend, getManagedSettings } from "@/lib/managedSpend.server";

const JOB_NAME = "managed-ads-spend-sync";

/** Every 15 min: charge managed-ads spend to client wallets and auto-pause when balance runs out. */
export const Route = createFileRoute("/api/public/managed-ads-spend")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const provided = request.headers.get("x-job-secret") || "";
        const { data: row } = await supabaseAdmin.from("internal_job_secrets").select("secret").eq("job_name", JOB_NAME).maybeSingle();
        const expected = (row as any)?.secret as string | undefined;
        if (!expected || provided.length !== expected.length || provided !== expected) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { pauseThreshold } = await getManagedSettings(supabaseAdmin);
        const { data: pages } = await (supabaseAdmin as any).from("managed_account_assignments").select("user_id");
        const users: string[] = Array.from(new Set<string>((pages ?? []).map((p: any) => String(p.user_id))));
        const results: any[] = [];
        for (const userId of users) {
          try {
            results.push({ userId, ...(await syncClientSpend(supabaseAdmin, userId, pauseThreshold)) });
          } catch (e: any) {
            results.push({ userId, error: e?.message });
          }
        }
        return Response.json({ ok: true, users: users.length, results });
      },
    },
  },
});
