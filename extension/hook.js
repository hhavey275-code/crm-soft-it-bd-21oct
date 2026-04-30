// ============================================================
//  DSL Sync — Page-world hook (v2.0.0) — SMIT-style
//  Runs in MAIN world (page JS context). Intercepts every
//  fetch / XMLHttpRequest the Facebook page makes, captures
//  fb_dtsg / lsd / jazoest / access_token and the raw GraphQL
//  responses for billing (cards, limits, threshold, balance,
//  total spending). Forwards everything to the isolated
//  content script via window.postMessage.
// ============================================================
(() => {
  if (window.__DSL_HOOK_INSTALLED__) return;
  window.__DSL_HOOK_INSTALLED__ = true;

  const TAG = "dsl-hook";
  const send = (type, payload) => {
    try {
      window.postMessage({ source: "dsl-hook", type, payload }, "*");
    } catch {}
  };

  // --------- credential extraction from request bodies ---------
  const creds = {
    fb_dtsg: null,
    lsd: null,
    jazoest: null,
    __user: null,
    __rev: null,
    __hs: null,
    __spin_r: null,
    __spin_t: null,
    __spin_b: null,
    av: null,
    access_token: null,
    captured_at: 0,
  };

  function ingestParams(params) {
    if (!params) return;
    let changed = false;
    const get = (k) =>
      typeof params.get === "function" ? params.get(k) : params[k];
    for (const k of [
      "fb_dtsg",
      "lsd",
      "jazoest",
      "__user",
      "__rev",
      "__hs",
      "__spin_r",
      "__spin_t",
      "__spin_b",
      "av",
      "access_token",
    ]) {
      const v = get(k);
      if (v && creds[k] !== v) {
        creds[k] = v;
        changed = true;
      }
    }
    if (changed) {
      creds.captured_at = Date.now();
      send("creds", { ...creds });
    }
  }

  function parseBody(body) {
    if (!body) return null;
    try {
      if (typeof body === "string") {
        if (body.startsWith("{")) {
          try { return new URLSearchParams(""); } catch { return null; }
        }
        return new URLSearchParams(body);
      }
      if (body instanceof URLSearchParams) return body;
      if (body instanceof FormData) {
        const sp = new URLSearchParams();
        for (const [k, v] of body.entries()) {
          if (typeof v === "string") sp.set(k, v);
        }
        return sp;
      }
    } catch {}
    return null;
  }

  // --------- response classification ---------
  function classify(url, text) {
    if (!url || !text) return null;
    const isGraphql = /\/api\/graphql\/?/.test(url) || /graph\.facebook\.com/.test(url);
    if (!isGraphql) return null;

    // Look at body fingerprints — Meta GraphQL responses are JSON or NDJSON
    const lower = text.slice(0, 6000);
    const hits = {
      cards:
        /payment_method|funding_source|credit_card|paypal_account|display_string/i.test(lower),
      threshold:
        /threshold_amount|billing_threshold|next_bill_date|amount_due/i.test(lower),
      limit:
        /adtrust_dsl|min_daily_budget|spend_cap|daily_spend_limit/i.test(lower),
      account:
        /account_status|timezone_name|currency|amount_spent|balance/i.test(lower),
    };
    if (!hits.cards && !hits.threshold && !hits.limit && !hits.account) return null;

    // Try to find an act_xxx in the body
    const actMatch = text.match(/act[_=]?(\d{8,})/);
    const accountId = actMatch ? actMatch[1] : null;

    return { url, accountId, hits, text: text.length > 800000 ? text.slice(0, 800000) : text };
  }

  function emitResponse(url, text) {
    const meta = classify(url, text);
    if (!meta) return;
    send("graphql", meta);
  }

  // --------- fetch hook ---------
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const body = init?.body ?? (typeof input !== "string" ? input?.body : null);
      ingestParams(parseBody(body));
      const p = origFetch.apply(this, arguments);
      // Tap response only for relevant URLs to avoid double-reading streams.
      if (/\/api\/graphql\/?|graph\.facebook\.com|billing_hub/.test(url)) {
        p.then((res) => {
          try {
            const cloned = res.clone();
            cloned.text().then((t) => emitResponse(url, t)).catch(() => {});
          } catch {}
        }).catch(() => {});
      }
      return p;
    } catch {
      return origFetch.apply(this, arguments);
    }
  };

  // --------- XHR hook ---------
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    const _open = xhr.open;
    xhr.open = function (method, url) {
      _url = url || "";
      return _open.apply(xhr, arguments);
    };
    const _send = xhr.send;
    xhr.send = function (body) {
      try { ingestParams(parseBody(body)); } catch {}
      xhr.addEventListener("load", function () {
        try {
          if (
            /\/api\/graphql\/?|graph\.facebook\.com|billing_hub/.test(_url) &&
            xhr.responseType === "" || xhr.responseType === "text"
          ) {
            emitResponse(_url, xhr.responseText || "");
          }
        } catch {}
      });
      return _send.apply(xhr, arguments);
    };
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  HookedXHR.UNSENT = 0; HookedXHR.OPENED = 1; HookedXHR.HEADERS_RECEIVED = 2;
  HookedXHR.LOADING = 3; HookedXHR.DONE = 4;
  window.XMLHttpRequest = HookedXHR;

  // --------- one-shot scan of inline scripts for fb_dtsg / token ---------
  function sweepInline() {
    try {
      const html = document.documentElement.outerHTML.slice(0, 2_000_000);
      const grab = (re, key) => {
        const m = html.match(re);
        if (m && m[1] && creds[key] !== m[1]) {
          creds[key] = m[1];
          creds.captured_at = Date.now();
        }
      };
      grab(/"DTSGInitData"[^}]*"token":"([^"]+)"/, "fb_dtsg");
      grab(/"LSD"[^}]*"token":"([^"]+)"/, "lsd");
      grab(/"jazoest=([^"]+)"/, "jazoest");
      grab(/"USER_ID":"(\d+)"/, "__user");
      grab(/"clientRevision":(\d+)/, "__rev");
      grab(/"haste_session":"([^"]+)"/, "__hs");
      grab(/"__spin_r":(\d+)/, "__spin_r");
      grab(/"__spin_t":(\d+)/, "__spin_t");
      grab(/"__spin_b":"([^"]+)"/, "__spin_b");
      // Long-lived ad token (EAA…) is gold for Graph API replays
      const tok = html.match(/EAA[A-Za-z0-9]{60,}/);
      if (tok && creds.access_token !== tok[0]) {
        creds.access_token = tok[0];
        creds.captured_at = Date.now();
      }
      send("creds", { ...creds });
    } catch {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sweepInline, { once: true });
  } else {
    sweepInline();
  }
  // Re-sweep periodically: SPA navigation often re-injects fresh tokens
  setInterval(sweepInline, 10000);

  // Reply to ping so content script knows hook is alive
  window.addEventListener("message", (e) => {
    if (e?.data?.source === "dsl-content" && e.data.type === "ping") {
      send("pong", { creds, ts: Date.now() });
    }
  });

  send("ready", { ts: Date.now(), url: location.href });
})();
