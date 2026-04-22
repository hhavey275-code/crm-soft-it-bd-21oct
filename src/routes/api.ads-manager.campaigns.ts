import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const META_API_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  statusFilter: z.string().min(1).max(50).optional().default("all"),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

let lastMetaVia: "proxy" | "direct" = "direct";
let lastMetaIp: string | null = null;

async function decryptToken(stored: string, secret: string) {
  if (!stored.startsWith("enc:")) return stored;

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("bm-token-enc-v1"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const combined = Uint8Array.from(atob(stored.slice(4)), (char) => char.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function metaFetch(url: string, options: RequestInit = {}) {
  if (!url.startsWith("https://graph.facebook.com/")) {
    return fetch(url, options);
  }

  const proxySecret = process.env.META_PROXY_SECRET;
  const proxyUrl = process.env.META_PROXY_URL || DEFAULT_META_PROXY_URL;

  if (proxySecret && proxyUrl) {
    try {
      const headers = new Headers(options.headers ?? {});
      const contentType = headers.get("Content-Type") ?? headers.get("content-type") ?? undefined;
      const method = options.method ?? "GET";
      const body =
        options.body instanceof URLSearchParams
          ? options.body.toString()
          : typeof options.body === "string"
            ? options.body
            : undefined;

      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret,
        },
        body: JSON.stringify({ url, method, body, contentType }),
      });

      const proxyIp = proxyRes.headers.get("x-egress-ip") || proxyRes.headers.get("x-proxy-ip");
      lastMetaVia = "proxy";
      lastMetaIp = proxyIp;
      const text = await proxyRes.text();
      return new Response(text, { status: proxyRes.status, headers: proxyRes.headers });
    } catch {
      lastMetaVia = "direct";
      lastMetaIp = null;
    }
  }

  lastMetaVia = "direct";
  lastMetaIp = null;
  return fetch(url, options);
}

async function verifyAccess(userId: string, accountId: string) {
  const [{ data: roles }, { data: assignment }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin.from("user_ad_accounts").select("id").eq("user_id", userId).eq("ad_account_id", accountId).maybeSingle(),
  ]);

  const isAdmin = (roles ?? []).some((row) => row.role === "admin" || row.role === "superadmin");
  return isAdmin || !!assignment;
}

export const Route = createFileRoute("/api/ads-manager/campaigns")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization") || "";
          if (!authHeader.startsWith("Bearer ")) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }

          const token = authHeader.replace("Bearer ", "").trim();
          const {
            data: { user },
            error: userError,
          } = await supabaseAdmin.auth.getUser(token);

          if (userError || !user) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }

          const parsed = bodySchema.safeParse(await request.json());
          if (!parsed.success) {
            return Response.json({ error: "Invalid request payload" }, { status: 400 });
          }

          const { accountId, statusFilter, dateFrom, dateTo } = parsed.data;
          const allowed = await verifyAccess(user.id, accountId);
          if (!allowed) {
            return Response.json({ error: "Forbidden" }, { status: 403 });
          }

          const { data: account, error: accountError } = await supabaseAdmin
            .from("ad_accounts")
            .select("id, account_id, account_name, business_manager_id, business_managers(access_token)")
            .eq("id", accountId)
            .maybeSingle();

          if (accountError || !account) {
            return Response.json({ error: "Ad account not found" }, { status: 404 });
          }

          const businessManager = Array.isArray((account as any).business_managers)
            ? (account as any).business_managers[0]
            : (account as any).business_managers;

          if (!businessManager?.access_token) {
            return Response.json({ error: "Business Manager token not found" }, { status: 400 });
          }

          const tokenSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (!tokenSecret) {
            return Response.json({ error: "Server not configured" }, { status: 500 });
          }

          const accessToken = await decryptToken(businessManager.access_token, tokenSecret);
          const actId = account.account_id.startsWith("act_") ? account.account_id : `act_${account.account_id}`;
          const encodedToken = encodeURIComponent(accessToken);

          const campaignsUrl = `${GRAPH_BASE}/${actId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time&limit=100&access_token=${encodedToken}`;
          const insightsUrl = `${GRAPH_BASE}/${actId}/insights?level=campaign&fields=campaign_id,spend,impressions,clicks,cpc,ctr,cpm,actions&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}&limit=100&access_token=${encodedToken}`;

          const [campaignsRes, insightsRes, profileRes] = await Promise.all([
            metaFetch(campaignsUrl),
            metaFetch(insightsUrl),
            supabaseAdmin.from("profiles").select("full_name, email").eq("user_id", user.id).maybeSingle(),
          ]);

          const campaignsJson = await campaignsRes.json().catch(() => ({}));
          if (!campaignsRes.ok) {
            return Response.json({ error: campaignsJson?.error?.message || "Failed to fetch campaigns" }, { status: campaignsRes.status || 500 });
          }

          const insightsJson = await insightsRes.json().catch(() => ({ data: [] }));
          const insightsMap = new Map<string, any>();
          for (const row of insightsJson?.data ?? []) {
            if (row?.campaign_id) insightsMap.set(row.campaign_id, row);
          }

          let campaigns = (campaignsJson?.data ?? []).map((campaign: any) => ({
            ...campaign,
            insights: insightsMap.get(campaign.id),
          }));

          if (statusFilter !== "all") {
            const normalized = statusFilter.toLowerCase();
            campaigns = campaigns.filter((campaign: any) => String(campaign.effective_status || "").toLowerCase().includes(normalized));
          }

          const userName = profileRes.data?.full_name || profileRes.data?.email || user.email || "Unknown";
          await supabaseAdmin.from("system_logs").insert({
            user_id: user.id,
            user_name: userName,
            action: "Ads Manager Campaign Fetch",
            details: `Fetched campaigns for ${account.account_name} (${actId}) via ${lastMetaVia} [IP: ${lastMetaIp || "direct"}]`,
          } as any);

          return Response.json({
            campaigns,
            fetchedAt: new Date().toISOString(),
            proxyIp: lastMetaIp,
            via: lastMetaVia,
          });
        } catch (error) {
          console.error("ads-manager campaign fetch failed", error);
          return Response.json({ error: "Failed to fetch campaigns" }, { status: 500 });
        }
      },
    },
  },
});