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
- For bKash cash-out receipts: if you see something like "৳3,958.11" with a breakdown "৳3,900.00 + ৳58.11", the correct amount is 3900 (the first/base number), NOT 3958.11. The charge (৳58.11) must be EXCLUDED.
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

export async function getOcrPriority(): Promise<Provider[]> {
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
        return arr.filter((p: string) => ["lovable", "gemini", "openai"].includes(p)) as Provider[];
      }
    }
  } catch (_) { /* ignore */ }
  return ["lovable", "gemini", "openai"];
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
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageUrl } },
        ] },
      ],
      tools: [{ type: "function", function: TOOL_SCHEMA }],
      tool_choice: { type: "function", function: { name: "extract_payment" } },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    const err: any = new Error(`lovable ${resp.status}: ${body.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (tc?.function?.arguments) return normalize(JSON.parse(tc.function.arguments));
  const content = data?.choices?.[0]?.message?.content;
  return normalize(safeJsonParse(content));
}

async function callGemini(imageUrl: string): Promise<OcrResult> {
  const apiKey = Deno.env.get("USER_GEMINI_API_KEY") || Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("USER_GEMINI_API_KEY/GEMINI_API_KEY not configured");
  // Fetch image and base64 it (Gemini accepts inline_data)
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`failed to fetch image: ${imgResp.status}`);
  const mime = imgResp.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buf = new Uint8Array(await imgResp.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const b64 = btoa(bin);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    const body = await resp.text();
    const err: any = new Error(`gemini ${resp.status}: ${body.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
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
    const body = await resp.text();
    const err: any = new Error(`openai ${resp.status}: ${body.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  return normalize(safeJsonParse(content));
}

export type OcrSuccess = { result: OcrResult; provider: Provider; attempts: Array<{ provider: Provider; ok: boolean; error?: string }> };

export async function runOcrWithFallback(imageUrl: string, prioritySetting?: Provider[]): Promise<OcrSuccess> {
  const priority = prioritySetting && prioritySetting.length > 0 ? prioritySetting : await getOcrPriority();
  const attempts: Array<{ provider: Provider; ok: boolean; error?: string }> = [];
  for (const provider of priority) {
    try {
      let result: OcrResult;
      if (provider === "lovable") result = await callLovable(imageUrl);
      else if (provider === "gemini") result = await callGemini(imageUrl);
      else result = await callOpenAI(imageUrl);
      attempts.push({ provider, ok: true });
      // Log to system_logs
      try {
        const supabase = getServiceClient();
        await supabase.from("system_logs").insert({
          action: "OCR Payment Extract",
          status: "success",
          details: `provider=${provider}; attempts=${JSON.stringify(attempts)}`,
        });
      } catch (_) {}
      return { result, provider, attempts };
    } catch (e: any) {
      attempts.push({ provider, ok: false, error: e?.message || String(e) });
      console.error(`[OCR] ${provider} failed:`, e?.message);
      continue;
    }
  }
  // All failed — log and throw
  try {
    const supabase = getServiceClient();
    await supabase.from("system_logs").insert({
      action: "OCR Payment Extract",
      status: "error",
      details: `All providers failed; attempts=${JSON.stringify(attempts)}`,
    });
  } catch (_) {}
  const summary = attempts.map((a) => `${a.provider}:${a.error || "ok"}`).join(" | ");
  throw new Error(`All OCR providers failed: ${summary}`);
}