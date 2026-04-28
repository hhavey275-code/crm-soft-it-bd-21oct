import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runOcrWithFallback, getOcrPriority } from "../_shared/ocr-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Small public test image with some text
const DEFAULT_TEST_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Sample_invoice.jpg/320px-Sample_invoice.jpg";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const imageUrl = body?.image_url || DEFAULT_TEST_IMAGE;
    const priority = await getOcrPriority();
    const out = await runOcrWithFallback(imageUrl, priority);
    return new Response(JSON.stringify({ ok: true, priority, ...out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});