// Website voice assistant — public (anyone on the site can talk to it).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function loadSettings() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("site_assistant_settings")
    .select("enabled, assistant_name, knowledge")
    .eq("id", 1)
    .maybeSingle();
  return data as { enabled: boolean; assistant_name: string; knowledge: string } | null;
}

export const getSiteAssistantInfo = createServerFn({ method: "GET" }).handler(async () => {
  const s = await loadSettings();
  return { enabled: !!s?.enabled && !!s?.knowledge?.trim(), name: s?.assistant_name || "Assistant" };
});

const askSchema = z.object({
  turns: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(1000) }))
    .min(1)
    .max(12),
});

export const askSiteAssistant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => askSchema.parse(d))
  .handler(async ({ data }) => {
    const s = await loadSettings();
    if (!s?.enabled) return { ok: false as const, answer: "", error: "Assistant is turned off." };
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false as const, answer: "", error: "Assistant is not configured." };
    const { askGateway, GatewayError } = await import("./siteAssistant.server");
    try {
      const answer = await askGateway({
        apiKey,
        name: s.assistant_name || "Assistant",
        knowledge: s.knowledge,
        turns: data.turns.slice(-10),
      });
      if (!answer) return { ok: false as const, answer: "", error: "No answer received." };
      return { ok: true as const, answer, error: null };
    } catch (e) {
      const status = e instanceof GatewayError ? e.status : 500;
      const error =
        status === 429 ? "Too many requests, please try again in a moment."
        : status === 402 || status === 403 ? "Assistant is temporarily unavailable."
        : "Something went wrong, please try again.";
      return { ok: false as const, answer: "", error };
    }
  });
