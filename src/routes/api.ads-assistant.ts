import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// AI Ads Assistant: turns a client's plain-English request into a campaign draft.
// It never touches Meta itself — the browser shows the draft and, after the client
// confirms, sends it through /api/managed-ads (the existing ownership-checked path).

const bodySchema = z.object({
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).min(1).max(30),
  pages: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200) })).max(200),
  account: z.object({ name: z.string().max(200), kind: z.string().max(20) }).nullable(),
});

const draftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "draft"],
  properties: {
    reply: { type: "string" },
    draft: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["pageDbId", "objective", "campaignName", "dailyBudget", "durationDays", "countries", "ageMin", "ageMax", "genders", "link"],
          properties: {
            pageDbId: { type: "string" },
            objective: { type: "string", enum: ["MESSAGES", "TRAFFIC", "ENGAGEMENT", "AWARENESS"] },
            campaignName: { type: "string" },
            dailyBudget: { type: "number" },
            durationDays: { type: ["integer", "null"] },
            countries: { type: "array", items: { type: "string" } },
            ageMin: { type: "integer" },
            ageMax: { type: "integer" },
            genders: { type: "string", enum: ["all", "men", "women"] },
            link: { type: ["string", "null"] },
          },
        },
      ],
    },
  },
} as const;

async function verifyUser(token: string): Promise<string | null> {
  if (!token) return null;
  const url = process.env.SUPABASE_URL || "https://dhswrfzdqcavgmymllat.supabase.co";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || "";
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u: any = await r.json().catch(() => null);
    return u?.id ? String(u.id) : null;
  } catch { return null; }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/ads-assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") || "";
        const uid = auth.startsWith("Bearer ") ? await verifyUser(auth.slice(7).trim()) : null;
        if (!uid) return json({ error: "Please sign in again." }, 401);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid request." }, 400);
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return json({ error: "AI is not configured." }, 500);
        const { turns, pages, account } = parsed.data;

        const instructions = `You are the AI Ads Assistant inside an ad-management CRM. You help a client create Meta (Facebook) ad campaigns by chatting.
Always reply in short, plain English (1-4 sentences), even if the client writes another language.
Current ad account: ${account ? `${account.name} (${account.kind})` : "none selected"}.
The client's connected Facebook Pages (use only these ids for pageDbId):
${pages.map((p) => `- ${p.name}: ${p.id}`).join("\n") || "(none — tell the client to connect a Page first)"}

Rules:
- Supported objectives: MESSAGES (Messenger conversations), TRAFFIC (website visits, needs a link), ENGAGEMENT (post engagement), AWARENESS (reach).
- When you know the Page, objective and daily budget (USD), return a draft. Defaults when not stated: countries ["BD"], age 18-65, genders "all", durationDays null (runs until paused), link null unless TRAFFIC.
- Country codes are 2-letter ISO. Ages 18-65. Daily budget minimum 1.
- If only one Page exists, use it. If something essential is missing or ambiguous, ask one short question and return draft null.
- Campaign name: short, descriptive, e.g. "ScaleUp - Messages - Oct".
- When returning a draft, tell the client to pick a post for the ad and press Confirm on the card. Never claim the ad is already live.
- For questions unrelated to ads, answer briefly and return draft null.`;

        const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
          body: JSON.stringify({
            model: "openai/gpt-6-astra",
            instructions,
            input: turns.map((t) => ({ role: t.role, content: [{ type: t.role === "user" ? "input_text" : "output_text", text: t.text }] })),
            stream: true,
            store: false,
            reasoning: { effort: "low", summary: "auto" },
            include: ["reasoning.encrypted_content"],
            text: { format: { type: "json_schema", name: "ads_assistant", strict: true, schema: draftSchema } },
          }),
        });
        if (!res.ok || !res.body) {
          const t = await res.text().catch(() => "");
          console.error("[ads-assistant] gateway", res.status, t.slice(0, 300));
          let msg = "The AI assistant is unavailable right now. Please try again shortly.";
          if (res.status === 402) msg = "AI credits are used up. Please contact the admin.";
          if (res.status === 429) msg = "Too many requests. Please wait a minute and try again.";
          return json({ error: msg }, res.status === 402 || res.status === 403 || res.status === 429 ? res.status : 502);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "", text = "", failed = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const p = line.slice(5).trim();
            if (!p || p === "[DONE]") continue;
            try {
              const ev = JSON.parse(p);
              if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
              if (ev.type === "error" || ev.type === "response.failed") failed = ev.error?.message ?? ev.response?.error?.message ?? "AI error";
            } catch { /* partial */ }
          }
        }
        if (failed) return json({ error: "The AI could not answer. Please try again." }, 502);
        try {
          const out = JSON.parse(text);
          if (out.draft && !pages.some((p) => p.id === out.draft.pageDbId)) out.draft = null;
          return json(out);
        } catch {
          return json({ reply: text || "Sorry, I could not understand that. Please try again.", draft: null });
        }
      },
    },
  },
});
