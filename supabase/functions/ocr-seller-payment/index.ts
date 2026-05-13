// LOCKED: Strict OCR + account verification for top-up payment proofs.
// Do NOT remove `verify_account_number` handling or the `account_verified` field —
// the client uses these to gate Submit. Loosening this re-opens the door to
// approving wrong-screenshot top-ups.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runOcrWithFallback } from "../_shared/ocr-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function verifyAccount(target: string, result: any, allowFirst3Last3 = false): boolean | null {
  const t = String(target || "").replace(/\D/g, "");
  if (t.length < 6) return null;
  const first3 = t.slice(0, 3);
  const last4 = t.slice(-4);
  const last3 = t.slice(-3);
  const rawOcrAcct = String(result?.account_number || "");
  const ocrAcct = rawOcrAcct.replace(/\D/g, "");
  if (ocrAcct) {
    if (ocrAcct === t) return true;
    if (ocrAcct.length >= 7 && ocrAcct.startsWith(first3) && ocrAcct.endsWith(last4)) return true;
    // Narrow exception: bKash/Nagad → Bank receipts often hide the full last 4 digits.
    // Allow first3+last3 ONLY when caller explicitly opts in for mfs_to_bank flow.
    if (allowFirst3Last3 && ocrAcct.length >= 6 && ocrAcct.startsWith(first3) && ocrAcct.endsWith(last3)) return true;
  }
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { image_url, verify_account_number, allow_first3_last3 } = await req.json();
    if (!image_url) {
      return new Response(JSON.stringify({ error: "image_url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { result, provider, attempts } = await runOcrWithFallback(image_url);
    const account_verified = verify_account_number
      ? verifyAccount(verify_account_number, result, !!allow_first3_last3)
      : null;

    return new Response(JSON.stringify({ ...result, account_verified, _provider: provider, _attempts: attempts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ocr-seller-payment error:", e?.message);
    return new Response(JSON.stringify({ error: e?.message || "OCR failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
