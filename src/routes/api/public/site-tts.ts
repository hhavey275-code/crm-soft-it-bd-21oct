// Natural Bangla/English voice for the website assistant (Lovable AI speech, streamed PCM over SSE).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({ text: z.string().min(1).max(700) });

export const Route = createFileRoute("/api/public/site-tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Invalid text", { status: 400 });
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Not configured", { status: 500 });

        const isBn = /[\u0980-\u09FF]/.test(parsed.data.text);
        const spoken = isBn
          ? `Speak in natural, warm Bangladeshi Bangla with a clear native accent, at a friendly conversational pace: ${parsed.data.text}`
          : `Say in a warm, friendly conversational tone: ${parsed.data.text}`;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3.1-flash-tts-preview",
            contents: [{ role: "user", parts: [{ text: spoken }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
            },
            stream_format: "sse",
          }),
        });
        if (!upstream.ok) console.error("[site-tts] upstream", upstream.status);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
