// Receives KAST bank emails forwarded by a Google Apps Script in the owner's Gmail.
// Caller must send the shared KAST_WEBHOOK_SECRET; only noreply@kast.xyz mail is stored.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  secret: z.string().min(8).max(200),
  message_id: z.string().max(300).optional(),
  from: z.string().max(300),
  subject: z.string().max(500).default(""),
  body: z.string().max(20000).default(""),
  date: z.string().max(100).optional(),
});

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function parseKast(subject: string, body: string) {
  const text = `${subject}\n${body}`;
  const otp =
    text.match(/(?:otp|code|passcode|verification)[^0-9]{0,40}(\d{4,8})/i)?.[1] ?? null;
  const card = text.match(/card\s*(?:ending\s*(?:in)?\s*)?\**\s*(\d{4})/i)?.[1] ?? null;
  let kind = "other";
  if (otp) kind = "otp";
  else if (/declined|unsuccessful/i.test(text)) kind = "declined";
  else if (/approved|successful/i.test(text)) kind = "approved";
  return { otp, card, kind };
}

export const Route = createFileRoute("/api/public/kast-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["KAST_WEBHOOK_SECRET"];
        if (!expected) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ ok: false, error: "bad request" }, { status: 400 });
        }
        if (!safeEqual(parsed.secret, expected))
          return Response.json({ ok: false }, { status: 401 });
        if (!/@kast\.xyz>?\s*$/i.test(parsed.from.trim()))
          return Response.json({ ok: true, skipped: true });

        const { otp, card, kind } = parseKast(parsed.subject, parsed.body);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const d = parsed.date ? new Date(parsed.date) : new Date();
        const { error } = await supabaseAdmin.from("kast_emails" as any).upsert(
          {
            message_id: parsed.message_id ?? null,
            from_email: parsed.from,
            subject: parsed.subject,
            body: parsed.body,
            otp,
            card_last4: card,
            kind,
            received_at: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
          },
          { onConflict: "message_id", ignoreDuplicates: true },
        );
        if (error) return Response.json({ ok: false, error: "save failed" }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
