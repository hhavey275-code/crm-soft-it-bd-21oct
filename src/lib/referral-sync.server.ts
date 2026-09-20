import { supabaseAdmin } from "@/integrations/supabase/client.server";

const META_API_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";

async function decryptToken(stored: string, secret: string) {
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
  const combined = Uint8Array.from(atob(stored.slice(4)), (char) => char.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function metaFetch(url: string) {
  const proxySecret = process.env['META_PROXY_SECRET'];
  const proxyUrl = process.env['META_PROXY_URL'] || DEFAULT_META_PROXY_URL;

  if (proxySecret && proxyUrl) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-proxy-secret": proxySecret },
        body: JSON.stringify({ url, method: "GET" }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));

      const text = await proxyRes.text();
      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");
      let isProxyOwnError = false;
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.error === "string") isProxyOwnError = true;
        } catch {
          /* ignore */
        }
      }
      if (!looksLikeHtml && !isProxyOwnError && proxyRes.status < 500) {
        return new Response(text, { status: proxyRes.status });
      }
    } catch (err) {
      console.warn("[referral-sync] proxy failed, direct fallback", err);
    }
  }

  return fetch(url);
}

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const endOfMonth = new Date(Date.UTC(y!, m!, 0));
  const today = new Date();
  const until = endOfMonth < today ? endOfMonth : today;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(start), until: iso(until < start ? start : until), periodMonth: `${month}-01` };
}

export type ReferralSyncResult = {
  month: string;
  accounts: number;
  updated: number;
  failed: string[];
};

/** Pull the month's spend for every ad account owned by this referrer's referred clients. */
export async function syncReferrerSpend(referrerId: string, month: string): Promise<ReferralSyncResult> {
  const { since, until, periodMonth } = monthRange(month);

  const { data: referred } = await supabaseAdmin
    .from("profiles")
    .select("user_id, full_name, email")
    .eq("referred_by", referrerId);

  const referredIds = (referred ?? []).map((r) => r.user_id);
  if (referredIds.length === 0) {
    return { month: periodMonth, accounts: 0, updated: 0, failed: [] };
  }
  const nameOf = new Map((referred ?? []).map((r) => [r.user_id, r.full_name || r.email || "Client"] as const));

  const [{ data: ownAccounts }, { data: assignments }] = await Promise.all([
    supabaseAdmin
      .from("ad_accounts")
      .select("id, account_id, account_name, user_id, business_managers(access_token)")
      .in("user_id", referredIds),
    supabaseAdmin.from("user_ad_accounts").select("ad_account_id, user_id").in("user_id", referredIds),
  ]);

  const accountOwner = new Map<string, string>();
  const accounts = new Map<string, any>();
  for (const acc of ownAccounts ?? []) {
    accounts.set(acc.id, acc);
    if (acc.user_id) accountOwner.set(acc.id, acc.user_id);
  }

  const missingIds = (assignments ?? [])
    .filter((a) => !accounts.has(a.ad_account_id))
    .map((a) => a.ad_account_id);
  if (missingIds.length > 0) {
    const { data: extra } = await supabaseAdmin
      .from("ad_accounts")
      .select("id, account_id, account_name, user_id, business_managers(access_token)")
      .in("id", missingIds);
    for (const acc of extra ?? []) accounts.set(acc.id, acc);
  }
  for (const a of assignments ?? []) {
    if (!accountOwner.has(a.ad_account_id)) accountOwner.set(a.ad_account_id, a.user_id);
  }

  const tokenSecret = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!tokenSecret) throw new Error("Server not configured");

  const list = [...accounts.values()];
  let updated = 0;
  const failed: string[] = [];

  const batchSize = 5;
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (acc: any) => {
        const bm = Array.isArray(acc.business_managers) ? acc.business_managers[0] : acc.business_managers;
        if (!bm?.access_token) {
          failed.push(acc.account_name || acc.account_id);
          return;
        }
        try {
          const accessToken = await decryptToken(bm.access_token, tokenSecret);
          const actId = String(acc.account_id).startsWith("act_") ? acc.account_id : `act_${acc.account_id}`;
          const url = `${GRAPH_BASE}/${actId}/insights?fields=spend&time_range=${encodeURIComponent(
            JSON.stringify({ since, until }),
          )}&limit=1&access_token=${encodeURIComponent(accessToken)}`;
          const res = await metaFetch(url);
          const json = (await res.json().catch(() => ({}))) as any;
          if (!res.ok) {
            failed.push(acc.account_name || acc.account_id);
            return;
          }
          const spend = Number(json?.data?.[0]?.spend ?? 0) || 0;
          const ownerId = accountOwner.get(acc.id) ?? acc.user_id;
          if (!ownerId) return;

          const { error } = await supabaseAdmin.rpc("upsert_referral_account_spend", {
            p_referrer: referrerId,
            p_referred: ownerId,
            p_referred_name: nameOf.get(ownerId) ?? "Client",
            p_ad_account: acc.id,
            p_account_name: acc.account_name,
            p_account_ref: String(acc.account_id),
            p_month: periodMonth,
            p_spend: spend,
          } as any);
          if (error) {
            failed.push(acc.account_name || acc.account_id);
            return;
          }
          updated += 1;
        } catch (err) {
          console.error("[referral-sync] account failed", acc.id, err);
          failed.push(acc.account_name || acc.account_id);
        }
      }),
    );
  }

  return { month: periodMonth, accounts: list.length, updated, failed };
}
