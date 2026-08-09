// WhatsApp Cloud API notification endpoint.
// Called by the DB trigger `trigger_whatsapp_on_wallet_topup` (transactions insert, type='top_up').
// Public prefix → secured by the X-Notify-Secret header.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const GRAPH_VERSION = "v21.0";

function normalizePhone(raw: string, cc: string): string | null {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith(cc)) {
    // already international
  } else if (d.startsWith("0")) {
    d = cc + d.slice(1);
  } else if (d.length <= 10) {
    d = cc + d;
  }
  return d.length >= 10 ? d : null;
}

function fmtUsd(n: number) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const Route = createFileRoute("/api/public/whatsapp-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

        const token = process.env["WHATSAPP_ACCESS_TOKEN"];
        const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
        const notifySecret = process.env["WHATSAPP_NOTIFY_SECRET"];
        const templateName = process.env["WHATSAPP_TEMPLATE_NAME"] || "wallet_topup_approved";
        const templateLang = process.env["WHATSAPP_TEMPLATE_LANG"] || "en";
        const cc = process.env["WHATSAPP_DEFAULT_COUNTRY_CODE"] || "880";

        if (!notifySecret || request.headers.get("x-notify-secret") !== notifySecret) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (!token || !phoneNumberId) {
          return json({ error: "WhatsApp credentials not configured" }, 500);
        }

        const body = (await request.json().catch(() => ({}))) as {
          user_id?: string;
          amount?: number;
          balance_after?: number;
          phone?: string;
          text?: string;
        };

        let phoneRaw = body.phone || null;
        let name = "Client";

        if (body.user_id) {
          const supabase = createClient(
            process.env["SUPABASE_URL"]!,
            process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
            { auth: { persistSession: false } },
          );
          const { data: profile } = await supabase
            .from("profiles")
            .select("phone, full_name, email")
            .eq("user_id", body.user_id)
            .maybeSingle();
          if (!phoneRaw) phoneRaw = (profile as any)?.phone || null;
          name = (profile as any)?.full_name || (profile as any)?.email || name;
        }

        const to = phoneRaw ? normalizePhone(phoneRaw, cc) : null;
        if (!to) return json({ skipped: true, reason: "no_phone_on_profile" });

        const amountStr = fmtUsd(Number(body.amount || 0));
        const balanceStr = fmtUsd(Number(body.balance_after || 0));

        const payload = body.text
          ? { messaging_product: "whatsapp", to, type: "text", text: { body: String(body.text) } }
          : {
              messaging_product: "whatsapp",
              to,
              type: "template",
              template: {
                name: templateName,
                language: { code: templateLang },
                components: [
                  {
                    type: "body",
                    parameters: [
                      { type: "text", text: name },
                      { type: "text", text: amountStr },
                      { type: "text", text: balanceStr },
                    ],
                  },
                ],
              },
            };

        const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const out: any = await res.json().catch(() => ({}));

        if (!res.ok) {
          console.error("WhatsApp send failed", res.status, JSON.stringify(out));
          return json({ ok: false, status: res.status, error: out?.error?.message || "send failed" });
        }
        return json({ ok: true, to, message_id: out?.messages?.[0]?.id || null });
      },
    },
  },
});
