// Shared OCR helper with multi-provider fallback (Lovable AI -> Gemini -> OpenAI)
// Supports user-defined priority order via site_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type OcrResult = {
  bdt_amount: string;
  date: string;
  reference: string;
  bank_name: string;
  account_number: string;
  account_holder_name: string;
};

export type Provider = "lovable" | "gemini" | "openai";

const SYSTEM_PROMPT = `You are an OCR assistant that extracts BDT bank/mobile-banking payment receipt details from an image.

CRITICAL RULE for "bdt_amount":
- Extract ONLY the principal/transfer amount that the sender SENT to the receiver (the base payment amount BEFORE any fees, charges, or VAT).
- DO NOT use the total debit amount, "Total", "সর্বমোট", "Total Debit Amount", or any value that INCLUDES cash-out charge / transaction fee / VAT.
- For bKash/Nagad cash-out receipts, "Cash Out Tk X" / "Amount: Tk X" is the principal amount received by the merchant. Extract X exactly; DO NOT subtract a separate fee/charge from it. If you see "Cash Out Tk 6,450.00" and a separate fee/charge, the correct amount is 6450.
- If you see a total-debit breakdown like "৳3,900.00 + ৳58.11 = ৳3,958.11", the correct amount is 3900 (the first/base number), NOT 3958.11. The charge (৳58.11) must be EXCLUDED.
- For bank transfer receipts (e.g. BRAC Astha): use "Transfer Amount" — NOT "Total Debit Amount". If Transfer Amount = 9,000 and Fee = 10 and Total Debit = 9,010, the correct amount is 9000.
- In short: amount sent to receiver, excluding all fees/charges/VAT.

Extract the following fields and return strictly valid JSON (no prose, no markdown):
{
  "bdt_amount": string (numeric only, principal amount excluding fees, e.g. "3900"),
  "date": string (YYYY-MM-DD),
  "reference": string (transaction id / TrxID),
  "bank_name": string,
  "account_number": string (receiver/destination account number only — the account that received the money, not sender/source),
  "account_holder_name": string
}
If a field is not visible, use empty string "".`;

const USER_PROMPT = "Extract the payment details from this receipt image and return only the JSON object.";

const TOOL_SCHEMA = {
  name: "extract_payment",
  description: "Extract structured BDT payment receipt fields.",
  parameters: {
    type: "object",
    properties: {
      bdt_amount: { type: "string" },
      date: { type: "string" },
      reference: { type: "string" },
      bank_name: { type: "string" },
      account_number: { type: "string" },
      account_holder_name: { type: "string" },
    },
    required: ["bdt_amount", "date", "reference", "bank_name", "account_number", "account_holder_name"],
    additionalProperties: false,
  },
};

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

let priorityCache: { value: Provider[]; at: number } | null = null;

export async function getOcrPriority(): Promise<Provider[]> {
  if (priorityCache && Date.now() - priorityCache.at < 60_000) return priorityCache.value;
  try {
    const supabase = getServiceClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "ocr_fallback_priority")
      .maybeSingle();
    if (data?.value) {
      const arr = JSON.parse(data.value);
      if (Array.isArray(arr) && arr.length > 0) {
        const v = arr.filter((p: string) => ["lovable", "gemini", "openai"].includes(p)) as Provider[];
        priorityCache = { value: v, at: Date.now() };
        return v;
      }
    }
  } catch (_) { /* ignore */ }
  return ["lovable", "gemini", "openai"];
}

// Fire-and-forget logging so OCR responses aren't delayed by a DB round-trip.
function logAsync(status: string, details: string) {
  try {
    const supabase = getServiceClient();
    void supabase.from("system_logs").insert({ action: "OCR Payment Extract", status, details });
  } catch (_) { /* ignore */ }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function normalize(obj: any): OcrResult {
  const s = (v: any) => (v == null ? "" : String(v));
  return {
    bdt_amount: s(obj?.bdt_amount).replace(/[^0-9.]/g, ""),
    date: s(obj?.date),
    reference: s(obj?.reference),
    bank_name: s(obj?.bank_name),
    account_number: s(obj?.account_number),
    account_holder_name: s(obj?.account_holder_name),
  };
}

function safeJsonParse(text: string): any {
  if (!text) throw new Error("empty response");
  // Strip code fences if any
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  // Find first { ... } block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("could not parse JSON from response");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(ms: number, min: number, max: number) {
  return Math.max(min, Math.min(max, ms));
}

function providerRetryAfterMs(provider: Provider, status: number, headers: Headers, body: string): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return clamp(seconds * 1000, 3_000, 70_000);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return clamp(dateMs - Date.now(), 3_000, 70_000);
  }

  const retryDelay = body.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i) || body.match(/retryDelay[^0-9]+([0-9.]+)s/i);
  if (retryDelay?.[1]) return clamp(Number(retryDelay[1]) * 1000, 3_000, 70_000);

  if ([500, 502, 503, 504, 529].includes(status)) return 5_000;
  if (status !== 429) return undefined;

  // Exhausted billing/quota is not a temporary rate limit — don't waste a minute waiting.
  if (/credits are depleted|RESOURCE_EXHAUSTED.*billing|insufficient_quota|billing details|check your plan|exceeded your current quota/i.test(body)) return undefined;

  // Gemini often omits RetryInfo on per-minute quota bursts; try again after the next minute once.
  if (provider === "gemini") return 65_000;


  // OpenAI 429 can be either temporary rate limit or exhausted billing quota. Don't wait for billing failures.
  if (provider === "openai" && /insufficient_quota|billing details|check your plan/i.test(body)) return undefined;
  if (provider === "openai") return 65_000;

  return undefined;
}

async function throwProviderError(provider: Provider, resp: Response): Promise<never> {
  const body = await resp.text();
  const retryAfterMs = providerRetryAfterMs(provider, resp.status, resp.headers, body);
  const err: any = new Error(`${provider} ${resp.status}: ${body.slice(0, 500)}`);
  err.status = resp.status;
  err.retryAfterMs = retryAfterMs;
  err.retryable = typeof retryAfterMs === "number";
  throw err;
}

async function callLovable(imageUrl: string): Promise<OcrResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "ocr-edge-fallback",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageUrl } },
        ] },
      ],
      tools: [{ type: "function", function: TOOL_SCHEMA }],
      tool_choice: { type: "function", function: { name: "extract_payment" } },
      max_tokens: 512,
    }),
  });
  if (!resp.ok) {
    await throwProviderError("lovable", resp);
  }
  const data = await resp.json();
  const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (tc?.function?.arguments) return normalize(JSON.parse(tc.function.arguments));
  const content = data?.choices?.[0]?.message?.content;
  return normalize(safeJsonParse(content));
}

async function callGemini(imageUrl: string): Promise<OcrResult> {
  const apiKey = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("USER_GEMINI_API_KEY") || Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("USER_GEMINI_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY not configured");
  // Fetch image and base64 it (Gemini accepts inline_data)
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`failed to fetch image: ${imgResp.status}`);
  const mime = imgResp.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buf = new Uint8Array(await imgResp.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const b64 = btoa(bin);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          { text: USER_PROMPT },
          { inline_data: { mime_type: mime, data: b64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: "object",
          properties: {
            bdt_amount: { type: "string" },
            date: { type: "string" },
            reference: { type: "string" },
            bank_name: { type: "string" },
            account_number: { type: "string" },
            account_holder_name: { type: "string" },
          },
          required: ["bdt_amount", "date", "reference", "bank_name", "account_number", "account_holder_name"],
        },
      },
    }),
  });
  if (!resp.ok) {
    await throwProviderError("gemini", resp);
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") || "";
  return normalize(safeJsonParse(text));
}

async function callOpenAI(imageUrl: string): Promise<OcrResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageUrl } },
        ] },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    await throwProviderError("openai", resp);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  return normalize(safeJsonParse(content));
}

export type OcrSuccess = { result: OcrResult; provider: Provider; attempts: Array<{ provider: Provider; ok: boolean; error?: string }> };

export async function runOcrWithFallback(
  imageUrl: string,
  prioritySetting?: Provider[],
  opts?: { fast?: boolean },
): Promise<OcrSuccess> {
  const fast = !!opts?.fast;
  const priority = prioritySetting && prioritySetting.length > 0 ? prioritySetting : await getOcrPriority();
  const attempts: Array<{ provider: Provider; ok: boolean; error?: string }> = [];
  // In fast mode never sleep a full quota window — just move to the next provider.
  const maxWaitMs = fast ? 2_000 : Number(Deno.env.get("OCR_RETRY_WAIT_MS") || "75000");
  const providerTimeoutMs = fast ? 20_000 : 60_000;
  const triedRetry = new Set<Provider>();
  const callProvider = async (provider: Provider): Promise<OcrResult> => {
    const run = provider === "lovable"
      ? callLovable(imageUrl)
      : provider === "gemini"
        ? callGemini(imageUrl)
        : callOpenAI(imageUrl);
    return await withTimeout(run, providerTimeoutMs, provider);
  };
  for (const provider of priority) {
    try {
      const result = await callProvider(provider);
      attempts.push({ provider, ok: true });
      logAsync("success", `provider=${provider}; attempts=${JSON.stringify(attempts)}`);
      return { result, provider, attempts };
    } catch (e: any) {
      attempts.push({ provider, ok: false, error: e?.message || String(e) });
      console.error(`[OCR] ${provider} failed:`, e?.message);
      // Only wait-and-retry the same provider when there is no other provider left to try.
      const isLast = provider === priority[priority.length - 1];
      if (e?.retryAfterMs && !triedRetry.has(provider) && (!fast || isLast)) {
        const waitMs = clamp(Number(e.retryAfterMs), 3_000, maxWaitMs);
        triedRetry.add(provider);
        console.warn(`[OCR] ${provider} rate-limited; retrying once after ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        try {
          const result = await callProvider(provider);
          attempts.push({ provider, ok: true });
          logAsync("success", `provider=${provider}; retried_after_ms=${waitMs}; attempts=${JSON.stringify(attempts)}`);
          return { result, provider, attempts };
        } catch (retryErr: any) {
          attempts.push({ provider, ok: false, error: `retry: ${retryErr?.message || String(retryErr)}` });
          console.error(`[OCR] ${provider} retry failed:`, retryErr?.message);
        }
      }
      continue;
    }
  }
  // All failed — log and throw
  logAsync("error", `All providers failed; attempts=${JSON.stringify(attempts)}`);
  const summary = attempts.map((a) => `${a.provider}:${a.error || "ok"}`).join(" | ");
  throw new Error(`All OCR providers failed: ${summary}`);
}