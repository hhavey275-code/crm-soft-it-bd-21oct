import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  deposit_id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(200)),
  client_name: z.string().max(300).nullish(),
  amount_cents: z.coerce.number().int().min(0).max(1e12),
  local_amount_minor: z.coerce.number().int().min(0).max(1e14).nullish(),
  local_currency: z.string().max(10).nullish(),
  reference: z.string().max(300).nullish(),
  created_at: z.string().max(60).nullish(),
});

export const Route = createFileRoute("/api/public/webhooks/softcards-deposit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { secretMatches, tryAutoMatch } = await import("@/lib/softcards.server");
        if (!secretMatches(request.headers.get("x-deposit-sync-secret"))) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
        const b = parsed.data;
        const created = b.created_at && !isNaN(Date.parse(b.created_at)) ? new Date(b.created_at).toISOString() : null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: existing } = await db.from("softcard_topups").select("*").eq("deposit_id", b.deposit_id).maybeSingle();
        if (existing) return Response.json({ ok: true, duplicate: true, status: existing.status });

        const { data: row, error } = await db.from("softcard_topups").insert({
          deposit_id: b.deposit_id,
          client_name: b.client_name ?? null,
          amount_cents: b.amount_cents,
          local_amount_minor: b.local_amount_minor ?? null,
          local_currency: b.local_currency ?? null,
          reference: b.reference ?? null,
          source_created_at: created,
        }).select("*").single();
        if (error) {
          if (error.code === "23505") return Response.json({ ok: true, duplicate: true });
          return Response.json({ error: "Save failed" }, { status: 500 });
        }
        let autoApproved = false;
        try { autoApproved = await tryAutoMatch(row); } catch (e) { console.error(e); }
        return Response.json({ ok: true, auto_approved: autoApproved });
      },
    },
  },
});
