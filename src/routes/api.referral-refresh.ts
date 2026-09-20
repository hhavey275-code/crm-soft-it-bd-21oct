import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncReferrerSpend } from "@/lib/referral-sync.server";

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  referrerId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/referral-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization") || "";
          if (!authHeader.startsWith("Bearer ")) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }
          const token = authHeader.replace("Bearer ", "").trim();
          const {
            data: { user },
            error: userError,
          } = await supabaseAdmin.auth.getUser(token);
          if (userError || !user) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }

          const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) {
            return Response.json({ error: "Invalid payload" }, { status: 400 });
          }

          const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", user.id);
          const isAdmin = (roles ?? []).some((r) => r.role === "admin" || r.role === "superadmin");

          const referrerId = parsed.data.referrerId && isAdmin ? parsed.data.referrerId : user.id;

          const { data: referrer } = await supabaseAdmin
            .from("profiles")
            .select("user_id, referral_enabled, referral_rate_bdt")
            .eq("user_id", referrerId)
            .maybeSingle();

          if (!referrer?.referral_enabled) {
            return Response.json({ error: "Referral program is not enabled for this account" }, { status: 403 });
          }

          const month = parsed.data.month ?? new Date().toISOString().slice(0, 7);
          const result = await syncReferrerSpend(referrerId, month);

          return Response.json({
            ok: true,
            month: result.month,
            accounts: result.accounts,
            updated: result.updated,
            failed: result.failed.slice(0, 10),
          });
        } catch (error) {
          console.error("[referral-refresh] failed", error);
          return Response.json({ error: "Refresh failed" }, { status: 500 });
        }
      },
    },
  },
});
