# Plan: BYO API Key fallback for OCR (Lovable → Gemini → OpenAI)

## লক্ষ্য

Lovable AI credit শেষ হলে / rate-limit হলে OCR যেন automatically আপনার নিজের Gemini বা OpenAI API key দিয়ে চলতে থাকে। Settings এ key দিতে পারবেন এবং fallback priority order ঠিক করতে পারবেন।

## ১. Supabase Secrets (storage)

৩টা নতুন secret add করব (Lovable secrets manager দিয়ে):

- `OPENAI_API_KEY` — আপনার OpenAI key
- `GEMINI_API_KEY_USER` — আপনার Gemini key (existing `GEMINI_API_KEY` Lovable-managed হতে পারে, তাই আলাদা নাম)
- (ঐচ্ছিক) `OCR_FALLBACK_PRIORITY` — না, এটা DB তে রাখব যাতে UI থেকে edit করা যায়

Settings এ key দেওয়ার সময় edge function call করে Supabase Vault এ লিখব। Frontend এ raw key কখনো প্রদর্শন করব না, শুধু "configured / not configured" status দেখাব।

## ২. Database — site_settings এ priority field

Existing site_settings table এ একটা JSON field যোগ করব:

```sql
ocr_fallback_priority text[] DEFAULT ARRAY['lovable','gemini','openai']
ocr_openai_configured boolean DEFAULT false  -- mirror flag, key value নয়
ocr_gemini_configured boolean DEFAULT false
```

Settings page থেকে read/write করা হবে। Actual key DB তে যাবে না — শুধু "configured আছে কিনা" এর flag।

## ৩. Settings UI (নতুন section)

`SettingsContent.tsx` এ "OCR Fallback Providers" section:

```
┌─ OCR Fallback Providers ────────────────────────────┐
│ Lovable AI credit শেষ হলে এই keys দিয়ে fallback হবে │
│                                                     │
│ Priority order: [Lovable] [Gemini] [OpenAI] (drag) │
│                                                     │
│ Gemini API Key      [●●●●●●●●●● configured] [Update]│
│ OpenAI API Key      [Not configured]        [Add]   │
│                                                     │
│ [Test fallback chain]                               │
└─────────────────────────────────────────────────────┘
```

- Drag-and-drop দিয়ে priority reorder
- "Update" বাটন → modal এ key paste → edge function `set-ocr-secret` call → Supabase secret update + flag true
- "Test" → দুম্মি image দিয়ে chain test, কোনটা কাজ করছে দেখাবে

## ৪. Shared OCR helper (নতুন)

`supabase/functions/_shared/ocr-fallback.ts` — সব OCR function এ ব্যবহার হবে:

```ts
export async function runOcrWithFallback(imageUrl, prompt, schema) {
  const priority = await getPriority(); // from site_settings
  const errors: Record<string, string> = {};
  
  for (const provider of priority) {
    try {
      if (provider === 'lovable') return await callLovable(...);
      if (provider === 'gemini') return await callGemini(...);   // user key
      if (provider === 'openai') return await callOpenAI(...);
    } catch (e) {
      errors[provider] = e.message;
      // Lovable 402/429 → next provider; অন্য error → next provider
      // Auth/network issue with user key → next provider
      continue;
    }
  }
  throw new Error(`All OCR providers failed: ${JSON.stringify(errors)}`);
}
```

Each provider function returns same shape: `{ bdt_amount, date, reference, bank_name, account_number, account_holder_name }`। Gemini/OpenAI উভয়ই vision API দিয়ে image_url accept করে, structured output (tool calling / response_format json) ব্যবহার করব।

## ৫. OCR edge functions

বর্তমানে যেগুলো Lovable AI direct call করে — সেগুলো এই helper ব্যবহার করবে:
- `ocr-seller-payment` (deployed but not in repo — recreate করব)
- যদি আরো ocr function থাকে (client/tenant এর জন্য), একই helper plug করব

System log এও entry লিখব: `OCR via gemini (lovable failed: 402)` — আপনি দেখতে পারবেন কোনটা use হলো।

## ৬. New edge functions

- `set-ocr-secret` — admin/superadmin only, body: `{provider: 'openai'|'gemini', api_key: string}`. Supabase Management API দিয়ে secret update করবে এবং site_settings এর `ocr_*_configured` flag true করবে। Key validate করতে একটা test call করবে আগে save করার আগে।
- `test-ocr-fallback` — chain run করে কোন provider working সেটা return করবে।

## ৭. Migration

```sql
ALTER TABLE site_settings 
  ADD COLUMN ocr_fallback_priority text[] DEFAULT ARRAY['lovable','gemini','openai'],
  ADD COLUMN ocr_openai_configured boolean DEFAULT false,
  ADD COLUMN ocr_gemini_configured boolean DEFAULT false;
```

RLS: শুধু superadmin read/update পারবে এই columns।

## ৮. Frontend OCR caller updates

`AdminSellers`, `ClientTopUp`, `TenantSystemTopUp`, `TenantSubscriptions` — এগুলোর কোডে কিছু পরিবর্তন লাগবে না (একই edge function call করছে)। শুধু error message update করব যাতে user বোঝে fallback chain run হয়েছে।

## প্রশ্ন একটাই বাকি

Settings page এ এই section টা **শুধু superadmin দেখবে** নাকি **সব admin** দেখবে? আমার suggestion: শুধু superadmin (কারণ keys global হবে এবং সব admin এর জন্য একই use হবে)। যদি ভিন্ন চান বলবেন।

## Deliverables

- 1 migration (3 columns site_settings এ)
- 2 new edge functions (`set-ocr-secret`, `test-ocr-fallback`)
- 1 shared helper (`_shared/ocr-fallback.ts`)
- 1 (re)created OCR function (`ocr-seller-payment` with fallback)
- Settings page এ "OCR Fallback Providers" section
- Secrets: `OPENAI_API_KEY`, `GEMINI_API_KEY_USER` add করার prompt আসবে আপনাকে
