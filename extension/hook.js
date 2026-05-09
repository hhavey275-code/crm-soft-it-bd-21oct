// ============================================================
//  DSL Sync — Page-world hook (v2.1.0)
//  Runs in MAIN world. Hooks fetch + XHR to capture:
//    - Meta credentials (fb_dtsg, lsd, jazoest, __user, __rev, __hs,
//      __spin_*, av, EAA access_token)
//    - Each GraphQL request: friendly_name + doc_id + variables
//    - Each GraphQL response (with the op name attached)
//  Forwards to the isolated content script via window.postMessage.
//  Also exposes a one-way replay channel: content.js can ask the
//  page to replay any captured op with new variables — that way the
//  request originates from facebook.com origin and inherits cookies.
// ============================================================
(() => {
  if (window.__DSL_HOOK_INSTALLED__) return;
  window.__DSL_HOOK_INSTALLED__ = true;

  const send = (type, payload) => {
    try {
      window.postMessage({ source: "dsl-hook", type, payload }, "*");
    } catch {}
  };

  const creds = {
    fb_dtsg: null, lsd: null, jazoest: null,
    __user: null, __rev: null, __hs: null,
    __spin_r: null, __spin_t: null, __spin_b: null,
    av: null, access_token: null, captured_at: 0,
  };

  // Cache the last seen request body for each friendly_name.
  // Used so we can REPLAY an exact mutation later (e.g. card remove).
  const opCache = Object.create(null);
  // Cache the last response body for each friendly_name (for diagnostics)
  const opResponseCache = Object.create(null);

  function ingestParams(params) {
    if (!params) return;
    let changed = false;
    const get = (k) => (typeof params.get === "function" ? params.get(k) : params[k]);
    for (const k of Object.keys(creds)) {
      if (k === "captured_at") continue;
      const v = get(k);
      if (v && creds[k] !== v) { creds[k] = v; changed = true; }
    }
    if (changed) {
      creds.captured_at = Date.now();
      send("creds", { ...creds });
    }
  }

  function paramsFromBody(body) {
    if (!body) return null;
    try {
      if (typeof body === "string") {
        // urlencoded form
        if (body.includes("=") && !body.startsWith("{")) return new URLSearchParams(body);
        return null;
      }
      if (body instanceof URLSearchParams) return body;
      if (body instanceof FormData) {
        const sp = new URLSearchParams();
        for (const [k, v] of body.entries()) if (typeof v === "string") sp.set(k, v);
        return sp;
      }
    } catch {}
    return null;
  }

  function captureRequestOp(url, body) {
    const sp = paramsFromBody(body);
    if (!sp) return null;
    ingestParams(sp);
    const friendly = sp.get("fb_api_req_friendly_name") || "";
    const doc_id = sp.get("doc_id") || "";
    const variables = sp.get("variables") || "";
    if (!friendly && !doc_id) return null;
    const op = {
      friendly_name: friendly,
      doc_id,
      variables,
      url,
      captured_at: Date.now(),
      // keep raw body string for clean replay
      body_string: typeof body === "string" ? body : sp.toString(),
    };
    if (friendly) opCache[friendly] = op;
    return op;
  }

  function classify(text) {
    if (!text) return null;
    const lower = text.slice(0, 8000);
    return {
      // Only flag as "cards" if response actually contains a real last-4
      // pattern. Prevents BM-wide / archived payment_method noise from
      // being treated as attached cards on the current account.
      cards: /last_four_digits"\s*:\s*"\d{4}"|•{2,}\s*\d{4}|\*{2,}\s*\d{4}|\.{2,}\s*\d{4}/i.test(lower),
      threshold: /threshold_amount|billing_threshold|next_bill_date|amount_due/i.test(lower),
      limit: /adtrust_dsl|min_daily_budget|spend_cap|daily_spend_limit/i.test(lower),
      account: /account_status|timezone_name|currency|amount_spent|balance/i.test(lower),
    };
  }

  function emitResponse(url, text, op) {
    if (!text) return;
    const isGraphql = /\/api\/graphql\/?|graph\.facebook\.com/.test(url);
    if (!isGraphql) return;
    const hits = classify(text);
    if (!hits.cards && !hits.threshold && !hits.limit && !hits.account && !op?.friendly_name) return;
    const accountMatch = text.match(/act[_=]?(\d{8,})/);
    const accountId = accountMatch ? accountMatch[1] : null;
    if (op?.friendly_name) opResponseCache[op.friendly_name] = { text: text.slice(0, 200000), captured_at: Date.now() };
    send("graphql", {
      url,
      accountId,
      hits,
      friendly_name: op?.friendly_name || null,
      doc_id: op?.doc_id || null,
      variables: op?.variables || null,
      text: text.length > 800000 ? text.slice(0, 800000) : text,
    });
  }

  // -------- fetch hook --------
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input?.url || "");
      const body = init?.body ?? (typeof input !== "string" ? input?.body : null);
      const op = /\/api\/graphql\/?/.test(url) ? captureRequestOp(url, body) : null;
      const p = origFetch.apply(this, arguments);
      if (/\/api\/graphql\/?|graph\.facebook\.com|billing_hub/.test(url)) {
        p.then((res) => {
          try {
            const cloned = res.clone();
            cloned.text().then((t) => emitResponse(url, t, op)).catch(() => {});
          } catch {}
        }).catch(() => {});
      }
      return p;
    } catch {
      return origFetch.apply(this, arguments);
    }
  };

  // -------- XHR hook --------
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    let _op = null;
    const _open = xhr.open;
    xhr.open = function (method, url) {
      _url = url || "";
      return _open.apply(xhr, arguments);
    };
    const _send = xhr.send;
    xhr.send = function (body) {
      try {
        if (/\/api\/graphql\/?/.test(_url)) _op = captureRequestOp(_url, body);
      } catch {}
      xhr.addEventListener("load", function () {
        try {
          if (/\/api\/graphql\/?|graph\.facebook\.com|billing_hub/.test(_url)) {
            const t = (xhr.responseType === "" || xhr.responseType === "text") ? (xhr.responseText || "") : "";
            if (t) emitResponse(_url, t, _op);
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

  // -------- inline-script sweep for fb_dtsg / token --------
  function sweepInline() {
    try {
      const html = document.documentElement.outerHTML.slice(0, 2_500_000);
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
  setInterval(sweepInline, 8000);

  // -------- replay channel --------
  // content.js -> page: { source:"dsl-content", type:"replay-op",
  //   reqId, friendly_name, override_variables: {...} }
  // page -> content.js: { source:"dsl-hook", type:"replay-op-result",
  //   reqId, ok, status, body }
  window.addEventListener("message", async (e) => {
    const data = e?.data;
    if (!data || data.source !== "dsl-content") return;

    if (data.type === "ping") {
      send("pong", { creds, ts: Date.now(), ops: Object.keys(opCache) });
      return;
    }

    if (data.type === "list-ops") {
      send("ops-list", { ops: Object.keys(opCache) });
      return;
    }

    if (data.type === "replay-op") {
      const reqId = data.reqId;
      const op = opCache[data.friendly_name];
      if (!op) {
        send("replay-op-result", { reqId, ok: false, error: "op_not_captured" });
        return;
      }
      try {
        // Build new body. Keep all original params but optionally override variables/__req.
        const sp = new URLSearchParams(op.body_string);
        if (data.override_variables) {
          let vars = {};
          try { vars = JSON.parse(op.variables || "{}"); } catch {}
          // shallow merge top-level + nested input merge if present
          if (data.override_variables.input && vars.input) {
            vars.input = { ...vars.input, ...data.override_variables.input };
          } else {
            vars = { ...vars, ...data.override_variables };
          }
          sp.set("variables", JSON.stringify(vars));
        }
        // Refresh fb_dtsg in case it rotated
        if (creds.fb_dtsg) sp.set("fb_dtsg", creds.fb_dtsg);
        if (creds.jazoest) sp.set("jazoest", creds.jazoest);
        if (creds.lsd) sp.set("lsd", creds.lsd);

        const res = await origFetch(op.url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-FB-Friendly-Name": op.friendly_name,
            "X-FB-LSD": creds.lsd || "",
            "Sec-Fetch-Site": "same-origin",
          },
          body: sp.toString(),
        });
        const text = await res.text();
        send("replay-op-result", { reqId, ok: res.ok, status: res.status, body: text.slice(0, 200000) });
      } catch (err) {
        send("replay-op-result", { reqId, ok: false, error: String(err?.message || err) });
      }
    }
  });

  send("ready", { ts: Date.now(), url: location.href });
})();

