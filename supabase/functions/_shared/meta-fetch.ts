// Shared Meta Graph API fetcher for all edge functions.
//
// Goal: every Meta call goes through the Vercel-hosted proxy so Facebook sees
// a single, stable egress IP. We only fall back to a direct call when the
// proxy itself is unreachable or returns a clearly broken response (HTML, 5xx,
// or proxy-own JSON error). Meta's own 4xx/200 responses are passed through
// unchanged so we never silently rotate IPs on legitimate API errors (which
// would risk account holds for sensitive writes like spend cap updates).
//
// Counters are per-function-instance globals. Call resetMetaCounters() at the
// start of every Deno.serve handler invocation.

const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";
const PROXY_TIMEOUT_MS = 8000;

let lastMetaVia: "proxy" | "direct" = "direct";
let lastMetaIp: string | null = null;
let metaProxyCount = 0;
let metaDirectCount = 0;
const metaProxyFailReasons: string[] = [];

export function resetMetaCounters() {
  lastMetaVia = "direct";
  lastMetaIp = null;
  metaProxyCount = 0;
  metaDirectCount = 0;
  metaProxyFailReasons.length = 0;
}

export function getLastMetaVia() {
  return lastMetaVia;
}

export function getLastMetaIp() {
  return lastMetaIp;
}

export function getMetaProxyCount() {
  return metaProxyCount;
}

export function getMetaDirectCount() {
  return metaDirectCount;
}

export function getMetaProxyFailReasons() {
  return [...metaProxyFailReasons];
}

function recordProxyFail(reason: string) {
  if (metaProxyFailReasons.length < 5 && !metaProxyFailReasons.includes(reason)) {
    metaProxyFailReasons.push(reason);
  }
}

/**
 * One-line summary of all Meta calls performed in the current request.
 * Useful for system_logs entries.
 */
export function metaCallSummary(prefix = " "): string {
  const total = metaProxyCount + metaDirectCount;
  const failNote = metaProxyFailReasons.length
    ? ` | proxy_fails=[${metaProxyFailReasons.join("; ")}]`
    : "";
  return `${prefix}[meta: ${total} call(s) — proxy=${metaProxyCount}, direct=${metaDirectCount}, ip=${lastMetaIp ?? "n/a"}${failNote}]`;
}

/**
 * Proxy-first fetch for Meta Graph API. Falls back to a direct call only
 * when the proxy is unhealthy. Non-graph URLs are passed through to fetch().
 */
export async function metaFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  if (!url.startsWith("https://graph.facebook.com/")) {
    return fetch(url, options);
  }

  const proxySecret = Deno.env.get("META_PROXY_SECRET")?.trim();
  const proxyUrl = (Deno.env.get("META_PROXY_URL") || DEFAULT_META_PROXY_URL).trim();

  if (proxySecret && proxyUrl) {
    try {
      const headers = new Headers(options.headers ?? {});
      const contentType =
        headers.get("Content-Type") ?? headers.get("content-type") ?? undefined;
      const method = options.method ?? "GET";
      const body =
        options.body instanceof URLSearchParams
          ? options.body.toString()
          : typeof options.body === "string"
            ? options.body
            : undefined;

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), PROXY_TIMEOUT_MS);
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret,
        },
        body: JSON.stringify({ url, method, body, contentType }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));

      // Capture egress IP whether or not we end up using this response.
      try {
        const proxyIp =
          proxyRes.headers.get("x-egress-ip") ||
          proxyRes.headers.get("x-proxy-ip");
        if (proxyIp) lastMetaIp = proxyIp;
      } catch {
        /* ignore */
      }

      const text = await proxyRes.text();
      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");

      // Detect proxy-level errors. The proxy reports its own failures as
      // {"error":"string"}; Meta errors are {"error":{"message":...,"code":...}}.
      let isProxyOwnError = false;
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.error === "string") {
            isProxyOwnError = true;
            recordProxyFail(`proxy_error:${parsed.error}`);
            console.warn("Proxy returned own error, falling back to direct:", parsed.error);
          }
        } catch {
          /* ignore parse failure — treat as opaque body */
        }
      }

      // Only fall back when the PROXY itself is unhealthy. Meta's own 4xx
      // responses must pass through unchanged so we don't silently switch to
      // direct IP for legitimate API errors (which risks Facebook flagging
      // the account for sudden IP rotation on writes).
      const shouldFallback =
        looksLikeHtml ||
        isProxyOwnError ||
        proxyRes.status >= 500 ||
        proxyRes.status === 0;

      if (!shouldFallback) {
        lastMetaVia = "proxy";
        metaProxyCount += 1;
        return new Response(text, {
          status: proxyRes.status,
          headers: proxyRes.headers,
        });
      }

      if (looksLikeHtml) recordProxyFail(`proxy_html(status=${proxyRes.status})`);
      if (!isProxyOwnError && proxyRes.status >= 500) {
        recordProxyFail(`proxy_5xx(status=${proxyRes.status})`);
      }
      console.warn(
        `Proxy unhealthy (status=${proxyRes.status}, html=${looksLikeHtml}, proxyErr=${isProxyOwnError}) — direct fallback`,
      );
    } catch (proxyErr) {
      const msg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
      recordProxyFail(`proxy_throw:${msg}`);
      console.warn("Proxy failed, falling back to direct call:", msg);
    }
  }

  lastMetaVia = "direct";
  metaDirectCount += 1;
  return fetch(url, options);
}