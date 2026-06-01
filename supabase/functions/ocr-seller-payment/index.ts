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
  const first4 = t.slice(0, 4);
  const last4 = t.slice(-4);
  const last3 = t.slice(-3);
  const rawOcrAcct = String(result?.account_number || "");
  const ocrAcct = rawOcrAcct.replace(/\D/g, "");
  const matches = (digits: string): boolean => {
    if (!digits) return false;
    if (digits === t) return true;
    if (digits.includes(t)) return true;
    if (digits.length >= 7 && digits.startsWith(first3) && digits.endsWith(last4)) return true;
    // Relaxed branch (bKash/Nagad → Bank only): first 4 + last 3 of target.
    if (allowFirst3Last3 && digits.length >= 7 && digits.startsWith(first4) && digits.endsWith(last3)) return true;
    return false;
  };
  if (matches(ocrAcct)) return true;
  const allText = [
    result?.account_number,
    result?.account_holder_name,
    result?.bank_name,
    result?.reference,
  ].filter(Boolean).map(String).join(" ");
  const allDigits = allText.replace(/\D/g, "");
  if (allDigits) {
    if (allDigits.includes(t)) return true;
    const re = new RegExp(`${first3}\\d{0,20}${last4}`, "g");
    if (re.test(allDigits)) return true;
    if (allowFirst3Last3) {
      const re2 = new RegExp(`${first4}\\d{0,20}${last3}`, "g");
      if (re2.test(allDigits)) return true;
    }
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
