// Retry an external CRM top-up whose Meta spend limit did not increase.
// Flow: check Meta live → if limit rose, done. Otherwise queue one helper
// retry (office PC extension picks it up via Auto-pilot). No wallet charge.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RetryResult =
  | { status: "updated"; before: number; after: number }
  | { status: "queued" }
  | { status: "blocked"; reason: string };

export const retryExternalTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { requestId: string }) => {
    if (!data?.requestId || typeof data.requestId !== "string") throw new Error("requestId is required");
    return { requestId: data.requestId };
  })
  .handler(async ({ data, context }): Promise<RetryResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;

    const { data: req } = await admin
      .from("external_topup_requests")
      .select("id, user_id, status, ad_account_id, spend_cap_before, spend_cap_after, retry_count, retry_requested_at")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req) throw new Error("Request not found");

    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "superadmin" }),
    ]);
    const privileged = !!isAdmin || !!isSuper;
    if (!privileged && req.user_id !== context.userId) throw new Error("Forbidden");

    if (req.status !== "completed") return { status: "blocked", reason: "Request এখনো শেষ হয়নি" };
    if (req.spend_cap_after != null) {
      return { status: "updated", before: Number(req.spend_cap_before ?? 0), after: Number(req.spend_cap_after) };
    }
    if (req.retry_requested_at) return { status: "blocked", reason: "Retry আগেই queue-তে আছে" };

    // 1) Live Meta check — the cap-change trigger fills spend_cap_after if it rose.
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (url && key) {
      await fetch(`${url}/functions/v1/get-account-insights`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify({ ad_account_ids: [req.ad_account_id], source: "meta" }),
      }).catch(() => null);
    }
    const { data: fresh } = await admin
      .from("external_topup_requests")
      .select("spend_cap_before, spend_cap_after")
      .eq("id", req.id)
      .maybeSingle();
    if (fresh?.spend_cap_after != null) {
      return { status: "updated", before: Number(fresh.spend_cap_before ?? 0), after: Number(fresh.spend_cap_after) };
    }
    // Trigger may miss if another request consumed it — compare directly.
    const { data: acct } = await admin.from("ad_accounts").select("spend_cap").eq("id", req.ad_account_id).maybeSingle();
    const cap = Number(acct?.spend_cap ?? 0);
    const before = Number(req.spend_cap_before ?? 0);
    if (cap > before + 0.01) {
      await admin
        .from("external_topup_requests")
        .update({ spend_cap_after: cap, limit_status: "updated", limit_reason: null, updated_at: new Date().toISOString() })
        .eq("id", req.id)
        .is("spend_cap_after", null);
      return { status: "updated", before, after: cap };
    }

    // 2) Clients get one retry; admins may retry again.
    if (!privileged && Number(req.retry_count ?? 0) >= 1) {
      return { status: "blocked", reason: "একবার retry হয়ে গেছে — admin-এর সাথে যোগাযোগ করুন" };
    }

    const now = new Date().toISOString();
    const { data: queued } = await admin
      .from("external_topup_requests")
      .update({
        retry_requested_at: now,
        retry_count: Number(req.retry_count ?? 0) + 1,
        automation_started_at: null,
        limit_status: "pending",
        limit_reason: "Retry queue-তে — helper আবার CRM-এ top-up দেবে",
        updated_at: now,
      })
      .eq("id", req.id)
      .is("retry_requested_at", null)
      .is("spend_cap_after", null)
      .select("id")
      .maybeSingle();
    if (!queued) return { status: "blocked", reason: "Retry আগেই queue-তে আছে" };

    // Wake the office helper instantly.
    await admin.from("autopilot_pings").insert({}).then(() => null, () => null);
    return { status: "queued" };
  });
