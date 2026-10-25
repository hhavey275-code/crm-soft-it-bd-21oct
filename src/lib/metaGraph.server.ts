// Server-only Meta Graph helpers shared by managed-ads routes.
const META_API_VERSION = "v25.0";
export const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";

export async function decryptToken(stored: string, secret: string) {
  if (!stored.startsWith("enc:")) return stored;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("bm-token-enc-v1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(decrypted);
}

export async function encryptToken(plain: string, secret: string) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("bm-token-enc-v1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  const all = new Uint8Array(12 + ct.length);
  all.set(iv); all.set(ct, 12);
  let s = ""; for (const b of all) s += String.fromCharCode(b);
  return "enc:" + btoa(s);
}

async function metaFetch(url: string, init: { method?: string; body?: string } = {}) {
  const proxySecret = process.env.META_PROXY_SECRET;
  const proxyUrl = process.env.META_PROXY_URL || DEFAULT_META_PROXY_URL;
  const method = init.method ?? "GET";
  const contentType = init.body ? "application/x-www-form-urlencoded" : undefined;
  if (proxySecret && proxyUrl) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-proxy-secret": proxySecret },
        body: JSON.stringify({ url, method, body: init.body, contentType }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      const text = await res.text();
      const t = text.trimStart();
      let proxyErr = false;
      if (t.startsWith("{")) {
        try { const p = JSON.parse(text); proxyErr = p && typeof p.error === "string"; } catch {}
      }
      if (!(t.startsWith("<") || proxyErr || res.status >= 500)) {
        return { status: res.status, json: safeJson(text) };
      }
    } catch (e) {
      console.error("[managed-ads] proxy failed", e);
    }
  }
  const res = await fetch(url, {
    method,
    headers: contentType ? { "Content-Type": contentType } : undefined,
    body: init.body,
  });
  return { status: res.status, json: safeJson(await res.text()) };
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return { error: { message: "Meta থেকে অপ্রত্যাশিত উত্তর" } }; }
}

export class MetaError extends Error {}

function metaMsg(json: any) {
  const e = json?.error ?? {};
  const parts = [e.error_user_title, e.error_user_msg || e.message].filter(Boolean);
  return (parts.join(": ") || "Meta error") + (e.code ? ` (#${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : "");
}

export function graphClient(token: string) {
  const get = async (path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ ...params, access_token: token });
    const { status, json } = await metaFetch(`${GRAPH_BASE}/${path}?${qs}`);
    if (status >= 400 || json?.error) throw new MetaError(metaMsg(json));
    return json;
  };
  const post = async (path: string, params: Record<string, unknown>) => {
    const body = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      body.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    const { status, json } = await metaFetch(`${GRAPH_BASE}/${path}`, { method: "POST", body: body.toString() });
    if (status >= 400 || json?.error) throw new MetaError(metaMsg(json));
    return json;
  };
  const del = async (path: string) => {
    const qs = new URLSearchParams({ access_token: token });
    await metaFetch(`${GRAPH_BASE}/${path}?${qs}`, { method: "DELETE" }).catch(() => null);
  };
  /** DELETE that reports Meta's answer instead of hiding failures. */
  const delStrict = async (path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ ...params, access_token: token });
    const { status, json } = await metaFetch(`${GRAPH_BASE}/${path}?${qs}`, { method: "DELETE" });
    if (status >= 400 || json?.error || json?.success === false) throw new MetaError(metaMsg(json));
    return json;
  };
  return { get, post, del, delStrict };
}
