import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const GRAPH = "https://graph.facebook.com/v25.0";
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

async function decryptToken(stored: string, secret: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("bm-token-enc-v1"), iterations: 100000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const combined = Uint8Array.from(atob(stored.slice(4)), (character) => character.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(decrypted);
}

async function metaFetch(url: string, options: RequestInit = {}) {
  const proxySecret = process.env["META_PROXY_SECRET"];
  const proxyUrl = process.env["META_PROXY_URL"] || DEFAULT_META_PROXY_URL;
  if (proxySecret) {
    try {
      const headers = new Headers(options.headers);
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-proxy-secret": proxySecret },
        body: JSON.stringify({
          url,
          method: options.method ?? "GET",
          body: typeof options.body === "string" ? options.body : undefined,
          contentType: headers.get("content-type") ?? undefined,
        }),
      });
      const text = await response.text();
      if (!/^\s*</.test(text) && response.status < 500) {
        return new Response(text, { status: response.status });
      }
    } catch (error) {
      console.warn("[bm-ad-accounts] Meta proxy unavailable; using direct connection", error);
    }
  }
  return fetch(url, options);
}

async function readMeta(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Meta সঠিক উত্তর দেয়নি (HTTP ${response.status})`);
  }
}

function metaError(output: any, status: number) {
  const error = output?.error ?? {};
  const message = error.error_user_msg || error.message || `Meta error (HTTP ${status})`;
  const code = error.code ? ` [code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""}]` : "";
  return `${message}${code}`;
}

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), bmId: z.string().uuid() }),
  z.object({
    action: z.literal("create"),
    bmId: z.string().uuid(),
    count: z.number().int().min(1).max(10),
    namePrefix: z.string().trim().min(1).max(60),
    startIndex: z.number().int().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezoneId: z.number().int().min(1),
    forceNumbered: z.boolean().optional(),
  }),
]);

export const Route = createFileRoute("/api/public/bm-ad-accounts")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
          if (!accessToken) return json({ ok: false, error: "আবার login করুন" }, 401);

          const parsed = inputSchema.safeParse(await request.json());
          if (!parsed.success) return json({ ok: false, error: "দেওয়া তথ্য সঠিক নয়" }, 400);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
          const userId = authData.user?.id;
          if (authError || !userId) return json({ ok: false, error: "Login session শেষ—আবার login করুন" }, 401);
          const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
            supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
            supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
          ]);
          if (!isAdmin && !isSuper) return json({ ok: false, error: "Admin access দরকার" }, 403);

          const { data: bm, error: bmError } = await supabaseAdmin
            .from("business_managers")
            .select("id, name, bm_id, access_token")
            .eq("id", parsed.data.bmId)
            .maybeSingle();
          if (bmError) return json({ ok: false, error: bmError.message }, 400);
          if (!bm?.access_token) return json({ ok: false, error: "এই BM-এ access token নেই—Reconnect করুন" }, 400);

          const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
          if (!serviceKey) return json({ ok: false, error: "Server token configuration নেই" }, 500);
          let bmToken: string;
          try {
            bmToken = await decryptToken(bm.access_token, serviceKey);
          } catch {
            return json({ ok: false, error: "BM token পড়া যায়নি—BM Reconnect করুন" }, 400);
          }

          if (parsed.data.action === "check") {
            const url = `${GRAPH}/${bm.bm_id}?fields=name,verification_status,owned_ad_accounts.limit(1).summary(true),client_ad_accounts.limit(1).summary(true)&access_token=${encodeURIComponent(bmToken)}`;
            const response = await metaFetch(url);
            const output = await readMeta(response);
            if (!response.ok || output?.error) return json({ ok: false, error: metaError(output, response.status) }, 400);
            return json({
              ok: true,
              ownedCount: output?.owned_ad_accounts?.summary?.total_count ?? null,
              clientCount: output?.client_ad_accounts?.summary?.total_count ?? null,
              verificationStatus: output?.verification_status ?? null,
            });
          }

          const created: Array<{ accountId: string; name: string }> = [];
          const failed: Array<{ name: string; error: string }> = [];
          let stoppedByLimit = false;
          for (let index = 0; index < parsed.data.count; index += 1) {
            const name = parsed.data.count === 1 && !parsed.data.forceNumbered
              ? parsed.data.namePrefix
              : `${parsed.data.namePrefix} ${parsed.data.startIndex + index}`;
            const form = new URLSearchParams({
              name,
              currency: parsed.data.currency,
              timezone_id: String(parsed.data.timezoneId),
              end_advertiser: bm.bm_id,
              media_agency: "NONE",
              partner: "NONE",
              access_token: bmToken,
            });
            const response = await metaFetch(`${GRAPH}/${bm.bm_id}/adaccount`, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: form.toString(),
            });
            const output = await readMeta(response);
            if (!response.ok || output?.error) {
              const error = metaError(output, response.status);
              failed.push({ name, error });
              stoppedByLimit = /limit|maximum number|1487742/i.test(error);
              if (stoppedByLimit) break;
              continue;
            }
            const rawId = String(output?.id ?? output?.account_id ?? "").replace(/^act_/, "");
            if (!rawId) {
              failed.push({ name, error: "Meta account ID ফেরত দেয়নি" });
              continue;
            }
            const { error: saveError } = await supabaseAdmin.from("ad_accounts").upsert({
              account_id: `act_${rawId}`,
              account_name: name,
              business_manager_id: bm.id,
              business_name: bm.name,
              status: "active",
              spend_cap: 0,
              amount_spent: 0,
            }, { onConflict: "account_id" });
            if (saveError) failed.push({ name, error: `Meta-তে হয়েছে, app-এ save হয়নি: ${saveError.message}` });
            created.push({ accountId: `act_${rawId}`, name });
          }
          return json({ ok: true, created, failed, stoppedByLimit, createdCount: created.length });
        } catch (error) {
          console.error("[bm-ad-accounts]", error);
          return json({ ok: false, error: error instanceof Error ? error.message : "Ad account তৈরি করা যায়নি" }, 500);
        }
      },
    },
  },
});