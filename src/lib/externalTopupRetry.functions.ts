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
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "superadmin" }),
    ]);
    const { retryExternalTopupServer } = await import("@/lib/externalTopupRetry.server");
    return retryExternalTopupServer(supabaseAdmin, data.requestId, context.userId, !!isAdmin || !!isSuper);
  });
