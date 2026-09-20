import { createFileRoute } from "@tanstack/react-router";
import { syncReferrerSpend } from "@/lib/referral-sync.server";

const JOB_NAME = "referral-nightly-sync";

/** Nightly job: pulls spend for every referral-enabled referrer (runs 12:00 AM Dhaka time). */
export const Route = createFileRoute("/api/public/referral-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const provided = request.headers.get("x-job-secret") || "";
          const { data: secretRow } = await supabaseAdmin
            .from("internal_job_secrets")
            .select("secret")
            .eq("job_name", JOB_NAME)
            .maybeSingle();

          const expected = (secretRow as any)?.secret as string | undefined;
          if (!expected || provided.length !== expected.length || provided !== expected) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }

          const url = new URL(request.url);
          const now = new Date();
          const months = new Set<string>([url.searchParams.get("month") ?? now.toISOString().slice(0, 7)]);
          // Early in a new month, also finish off the previous month's numbers.
          if (!url.searchParams.get("month") && now.getUTCDate() <= 3) {
            const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
            months.add(prev.toISOString().slice(0, 7));
          }

          const { data: referrers } = await supabaseAdmin
            .from("profiles")
            .select("user_id")
            .eq("referral_enabled", true);

          let totalUpdated = 0;
          let totalFailed = 0;
          for (const ref of referrers ?? []) {
            for (const month of months) {
              try {
                const result = await syncReferrerSpend(ref.user_id, month);
                totalUpdated += result.updated;
                totalFailed += result.failed.length;
              } catch (err) {
                console.error("[referral-cron] referrer failed", ref.user_id, month, err);
                totalFailed += 1;
              }
            }
          }

          return Response.json({
            ok: true,
            referrers: (referrers ?? []).length,
            months: [...months],
            updated: totalUpdated,
            failed: totalFailed,
          });
        } catch (error) {
          console.error("[referral-cron] failed", error);
          return Response.json({ error: "Cron failed" }, { status: 500 });
        }
      },
    },
  },
});
