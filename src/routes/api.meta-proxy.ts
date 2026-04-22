import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, x-proxy-secret",
  "Access-Control-Max-Age": "86400",
} as const;

const proxyBodySchema = z.object({
  url: z.string().url(),
  method: z.string().trim().toUpperCase().optional().default("GET"),
  body: z.string().optional(),
  contentType: z.string().optional(),
});

const allowedHosts = new Set(["graph.facebook.com"]);

let cachedEgressIp: { value: string | null; fetchedAt: number } | null = null;

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return withCors(
    Response.json(payload, {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    })
  );
}

function isAllowedTarget(rawUrl: string) {
  try {
    const target = new URL(rawUrl);
    return target.protocol === "https:" && allowedHosts.has(target.hostname);
  } catch {
    return false;
  }
}

async function getEgressIp() {
  const now = Date.now();
  if (cachedEgressIp && now - cachedEgressIp.fetchedAt < 10 * 60 * 1000) {
    return cachedEgressIp.value;
  }

  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      cachedEgressIp = { value: null, fetchedAt: now };
      return null;
    }

    const json = (await response.json().catch(() => ({}))) as { ip?: string };
    const ip = typeof json.ip === "string" && json.ip.trim() ? json.ip.trim() : null;
    cachedEgressIp = { value: ip, fetchedAt: now };
    return ip;
  } catch {
    cachedEgressIp = { value: null, fetchedAt: now };
    return null;
  }
}

export const Route = createFileRoute("/api/meta-proxy")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: corsHeaders,
        }),
      GET: async () =>
        jsonResponse({
          ok: true,
          route: "/api/meta-proxy",
          message: "Meta proxy is reachable",
        }),
      POST: async ({ request }) => {
        const configuredSecret = process.env.META_PROXY_SECRET;
        if (!configuredSecret) {
          return jsonResponse({ error: "META_PROXY_SECRET is not configured" }, 500);
        }

        const incomingSecret = request.headers.get("x-proxy-secret")?.trim();
        if (!incomingSecret || incomingSecret !== configuredSecret) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }

        const body = proxyBodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) {
          return jsonResponse({ error: "Invalid proxy payload" }, 400);
        }

        if (!isAllowedTarget(body.data.url)) {
          return jsonResponse({ error: "Target URL is not allowed" }, 403);
        }

        try {
          const headers = new Headers();
          if (body.data.contentType && body.data.body && !["GET", "HEAD"].includes(body.data.method)) {
            headers.set("Content-Type", body.data.contentType);
          }

          const upstream = await fetch(body.data.url, {
            method: body.data.method,
            headers,
            body: ["GET", "HEAD"].includes(body.data.method) ? undefined : body.data.body,
          });

          const responseHeaders = new Headers();
          const upstreamContentType = upstream.headers.get("content-type");
          if (upstreamContentType) {
            responseHeaders.set("Content-Type", upstreamContentType);
          }

          const upstreamDisposition = upstream.headers.get("content-disposition");
          if (upstreamDisposition) {
            responseHeaders.set("Content-Disposition", upstreamDisposition);
          }

          const egressIp = await getEgressIp();
          if (egressIp) {
            responseHeaders.set("x-egress-ip", egressIp);
          }
          responseHeaders.set("x-proxy-target", new URL(body.data.url).hostname);
          responseHeaders.set("Cache-Control", "no-store");

          return withCors(
            new Response(upstream.body, {
              status: upstream.status,
              headers: responseHeaders,
            })
          );
        } catch (error) {
          console.error("[meta-proxy] request failed", error);
          return jsonResponse({ error: "Proxy request failed" }, 502);
        }
      },
    },
  },
});