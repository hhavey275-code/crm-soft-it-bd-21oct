import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data: a } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (a) return;
  const { data: s } = await supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" });
  if (!s) throw new Error("Forbidden");
}

export const decideSoftcardTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      deposit_id: z.string().min(1).max(200),
      action: z.enum(["approve", "reject"]),
      note: z.string().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.action === "reject" && !data.note?.trim()) throw new Error("Reject reason required");
    const { sendDecision } = await import("@/lib/softcards.server");
    return sendDecision(data.deposit_id, data.action, data.note?.trim() || null, { by: context.userId, via: "manual" });
  });

export const sweepSoftcardTopups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { sweepPending } = await import("@/lib/softcards.server");
    return sweepPending();
  });
