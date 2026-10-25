import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const bmPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.discriminatedUnion("action", [
    z.object({ action: z.literal("list"), bmDbId: z.string().uuid() }),
    z.object({ action: z.literal("import"), bmDbId: z.string().uuid(), pageId: z.string().regex(/^\d{5,25}$/), clientId: z.string().uuid() }),
  ]).parse(input))
  .handler(async ({ data, context }) => {
    const [{ data: admin }, { data: superadmin }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "superadmin" }),
    ]);
    const { requireBmPageAdmin, readBmPages, importBmPage } = await import("./bmPages.server");
    requireBmPageAdmin(admin === true || superadmin === true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "list") return { pages: await readBmPages(supabaseAdmin, data.bmDbId) };
    return { page: await importBmPage(supabaseAdmin, context.userId, data) };
  });