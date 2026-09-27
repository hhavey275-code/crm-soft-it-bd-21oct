// Server-only: calls Lovable AI Gateway (Responses API, streamed) for the website voice assistant.
export type AssistantTurn = { role: "user" | "assistant"; text: string };

export class GatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function askGateway(opts: {
  apiKey: string;
  name: string;
  knowledge: string;
  turns: AssistantTurn[];
}): Promise<string> {
  const instructions = `You are "${opts.name}", a friendly voice assistant on this company's website, talking with potential and existing clients.
Rules:
- Answer ONLY from the company information below. If the answer isn't there, say you don't know and suggest contacting the team / signing up.
- Always reply in natural, conversational Bangladeshi Bangla, even if the client uses English. Keep company names as provided.
- This is spoken aloud: keep replies short (1-3 sentences), natural, no markdown, no lists, no emojis, no URLs read out.
- Never invent prices, rates or promises.

COMPANY INFORMATION:
${opts.knowledge || "(No information has been provided yet.)"}`;

  const input = opts.turns.map((t) => ({
    role: t.role,
    content: [{ type: t.role === "user" ? "input_text" : "output_text", text: t.text }],
  }));

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": opts.apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.error("[site-assistant] gateway error", res.status, body.slice(0, 500));
    throw new GatewayError(res.status, body.slice(0, 300));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
        if (ev.type === "error" || ev.type === "response.failed") {
          throw new GatewayError(500, ev.error?.message ?? ev.response?.error?.message ?? "AI error");
        }
      } catch (e) {
        if (e instanceof GatewayError) throw e;
      }
    }
  }
  return text.trim();
}
