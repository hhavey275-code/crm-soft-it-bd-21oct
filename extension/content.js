// ============================================================
//  DSL Sync — Content script (v2.0.0) — SMIT-style bridge
//  - Injects hook.js into the page MAIN world
//  - Listens for captured creds + GraphQL responses from hook
//  - Caches per-account snapshots in chrome.storage.local
//  - Renders the larger floating "Ads Check by CRM" panel
//  - Forwards remove-card / sync-to-CRM intents to background
// ============================================================
(() => {
  if (window.__DSL_CONTENT_INSTALLED__) return;
  window.__DSL_CONTENT_INSTALLED__ = true;

  const BILLING_RE = /\/billing_hub\/(accounts|payment_methods)\b/;
  const PANEL_ID = "dsl-crm-panel";

  // ---------------- inject MAIN-world hook ----------------
  function injectHook() {
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("hook.js");
      s.async = false;
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn("[DSL] hook inject failed", e);
    }
  }
  injectHook();

  // ---------------- state ----------------
  const state = {
    creds: null,
    accountId: null,
    snapshot: null, // current account billing snapshot
    raw: { cards: null, threshold: null, limit: null, account: null },
    lastSyncedKey: "",
    statusText: "Waiting for billing data…",
  };

  // ---------------- helpers ----------------
  function getAccountIdFromUrl() {
    try {
      const u = new URL(location.href);
      const a =
        u.searchParams.get("asset_id") ||
        u.searchParams.get("payment_account_id") ||
        u.searchParams.get("account_id") ||
        u.searchParams.get("act");
      if (a) return String(a).replace(/^act_/, "");
    } catch {}
    const m = location.href.match(/act[_=](\d{6,})/);
    return m ? m[1] : null;
  }

  function cur(amount, c) {
    if (amount === null || amount === undefined || isNaN(Number(amount))) return null;
    const ccy = c || "USD";
    return `${Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${ccy}`;
  }

  // Convert Meta money values: many GraphQL fields are integer cents-like; some are decimal strings.
  function money(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "object") {
      // {amount: "12345", currency: "USD", offset: 100} pattern
      const a = Number(v.amount ?? v.value ?? 0);
      const off = Number(v.offset || v.currency_offset || 0);
      if (!Number.isFinite(a)) return null;
      return off > 1 ? a / off : a;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ---------------- snapshot extraction from intercepted GraphQL ----------------
  function safeParse(text) {
    if (!text) return null;
    // Meta sometimes prefixes responses with "for (;;);" or sends NDJSON
    const cleaned = text.replace(/^for \(;;\);/, "").trim();
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      try { return JSON.parse(cleaned); } catch {}
    }
    // Try line-by-line JSON
    const out = [];
    for (const line of cleaned.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch {}
    }
    return out.length ? out : null;
  }

  function walk(node, visitor, depth = 0) {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v, visitor, depth + 1);
      return;
    }
    if (typeof node === "object") {
      visitor(node);
      for (const k in node) walk(node[k], visitor, depth + 1);
    }
  }

  function extractFromGraphqlText(text) {
    const data = safeParse(text);
    if (!data) return;
    const accountId = state.accountId || getAccountIdFromUrl();
    walk(data, (obj) => {
      // Cards / payment methods
      if (
        (obj.__typename && /PaymentMethod|CreditCard|FundingSource/i.test(obj.__typename)) ||
        (obj.display_string && (obj.credit_card_number || obj.last_four_digits || obj.exp_month))
      ) {
        if (!state.raw.cards) state.raw.cards = [];
        const card = normalizeCardNode(obj);
        if (card) {
          // dedupe by id
          const exists = state.raw.cards.find((c) => c.id === card.id);
          if (!exists) state.raw.cards.push(card);
          else Object.assign(exists, card);
        }
      }
      // Threshold / billing cycle
      if (obj.threshold_amount || obj.billing_threshold || obj.next_bill_date) {
        const t = money(obj.threshold_amount || obj.billing_threshold);
        if (t) state.raw.threshold = t;
        if (obj.amount_due) state.raw.balance = money(obj.amount_due);
      }
      // Account-level fields
      if (obj.account_status || obj.timezone_name || obj.adtrust_dsl || obj.amount_spent) {
        state.raw.account = state.raw.account || {};
        if (obj.account_status) state.raw.account.account_status = obj.account_status;
        if (obj.account_status_string) state.raw.account.account_status = obj.account_status_string;
        if (obj.timezone_name) state.raw.account.timezone_name = obj.timezone_name;
        if (obj.account_type) state.raw.account.account_type = obj.account_type;
        if (obj.currency) state.raw.account.currency = obj.currency;
        if (obj.adtrust_dsl) state.raw.account.adtrust_dsl = money(obj.adtrust_dsl);
        if (obj.min_daily_budget) state.raw.account.min_daily_budget = money(obj.min_daily_budget);
        if (obj.amount_spent) state.raw.account.amount_spent = money(obj.amount_spent);
        if (obj.balance) state.raw.account.balance = money(obj.balance);
        if (obj.spend_cap) state.raw.account.spend_cap = money(obj.spend_cap);
        if (obj.outstanding_balance) state.raw.account.outstanding_balance = money(obj.outstanding_balance);
      }
    });
    // Rebuild snapshot
    rebuildSnapshot(accountId);
    renderPanel();
  }

  function normalizeCardNode(obj) {
    const last4 =
      obj.last_four_digits ||
      obj.credit_card_last_four ||
      (obj.display_string && (obj.display_string.match(/(\d{4})\s*$/) || [])[1]) ||
      null;
    const brand =
      (obj.credit_card_type ||
        obj.type ||
        obj.payment_method_type ||
        (obj.display_string && (obj.display_string.match(/^([A-Za-z ]+?)\s+/) || [])[1]) ||
        "card")
        .toString()
        .toLowerCase()
        .replace(/\s+/g, "");
    const id = String(
      obj.id ||
        obj.payment_method_id ||
        obj.funding_source_id ||
        obj.credit_card_id ||
        (last4 ? `local:${brand}:${last4}` : ""),
    );
    if (!id) return null;
    return {
      id,
      display_string:
        obj.display_string ||
        `${brand.toUpperCase()} *${last4 || "----"}`,
      type: brand,
      last4,
      exp_month: obj.exp_month || obj.expiration_month || null,
      exp_year: obj.exp_year || obj.expiration_year || null,
      is_primary: !!(obj.is_primary || obj.is_default || obj.default_method),
      is_backup: !!(obj.is_backup || obj.is_secondary),
      removable: !String(id).startsWith("local:"),
    };
  }

  function rebuildSnapshot(accountId) {
    const acc = state.raw.account || {};
    const dsl = acc.adtrust_dsl || acc.min_daily_budget || null;
    state.snapshot = {
      account_id: accountId || state.accountId,
      currency: acc.currency || "USD",
      account_status: acc.account_status || null,
      account_type: acc.account_type || null,
      timezone_name: acc.timezone_name || null,
      visible_limit: acc.spend_cap || null,
      hidden_daily_limit: dsl,
      billing_threshold: state.raw.threshold || null,
      outstanding_balance: acc.outstanding_balance || null,
      balance: acc.balance || state.raw.balance || null,
      total_spending: acc.amount_spent || null,
      cards: state.raw.cards || [],
      parsed_at: new Date().toISOString(),
      source_url: location.href,
    };
  }

  // ---------------- panel UI (bigger, SMIT-like) ----------------
  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: "fixed",
      top: "70px",
      right: "20px",
      width: "480px",
      maxHeight: "88vh",
      overflowY: "auto",
      background: "#ffffff",
      color: "#0f172a",
      border: "1px solid #e2e8f0",
      borderRadius: "14px",
      boxShadow: "0 18px 48px rgba(15,23,42,0.28)",
      zIndex: "2147483646",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "14px",
      lineHeight: "1.55",
    });
    panel.innerHTML = `
      <div id="dsl-crm-head" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-radius:14px 14px 0 0;cursor:move;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:16px;">📊</div>
          <div>
            <div style="font-weight:700;font-size:16px;line-height:1.1;">Ads Check by CRM</div>
            <div style="font-size:11px;opacity:0.9;" id="dsl-crm-subhead">v2.0.0 — live hook</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button id="dsl-crm-sync" title="Push snapshot to CRM" style="background:rgba(255,255,255,0.22);border:none;color:#fff;border-radius:7px;padding:7px 12px;cursor:pointer;font-size:13px;font-weight:600;">Sync to CRM</button>
          <button id="dsl-crm-collapse" title="Hide" style="background:rgba(255,255,255,0.22);border:none;color:#fff;border-radius:7px;padding:7px 12px;cursor:pointer;font-size:14px;font-weight:700;line-height:1;">—</button>
        </div>
      </div>
      <div id="dsl-crm-body" style="padding:14px 16px;"></div>
      <div id="dsl-crm-status" style="padding:10px 16px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;background:#f8fafc;border-radius:0 0 14px 14px;">${state.statusText}</div>
    `;
    document.documentElement.appendChild(panel);
    panel.querySelector("#dsl-crm-collapse").addEventListener("click", () => {
      const body = panel.querySelector("#dsl-crm-body");
      const status = panel.querySelector("#dsl-crm-status");
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      status.style.display = hidden ? "block" : "none";
    });
    panel.querySelector("#dsl-crm-sync").addEventListener("click", () => pushToCRM(true));
    enableDrag(panel);
    return panel;
  }

  function enableDrag(panel) {
    const head = panel.querySelector("#dsl-crm-head");
    let dx = 0, dy = 0, sx = 0, sy = 0, dragging = false;
    head.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect(); dx = r.left; dy = r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = dx + (e.clientX - sx) + "px";
      panel.style.top = dy + (e.clientY - sy) + "px";
      panel.style.right = "auto";
    });
    window.addEventListener("mouseup", () => (dragging = false));
  }

  function row(label, value, opts = {}) {
    if (value === null || value === undefined || value === "") return "";
    const accent = opts.accent
      ? "color:#059669;font-weight:700;font-size:14px;"
      : "font-size:13px;";
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9;">
      <span style="color:#64748b;font-size:12px;">${label}</span>
      <span style="${accent}text-align:right;">${value}</span>
    </div>`;
  }

  function renderPanel() {
    const panel = ensurePanel();
    const body = panel.querySelector("#dsl-crm-body");
    const sub = panel.querySelector("#dsl-crm-subhead");
    const snap = state.snapshot;
    const accId = (snap && snap.account_id) || state.accountId || getAccountIdFromUrl();
    if (sub) sub.textContent = accId ? `act_${accId}` : "v2.0.0 — live hook";
    if (!snap || !accId) {
      body.innerHTML = `<div style="color:#94a3b8;padding:8px 0;">Open an ad account on the Billing page. Live data will appear here automatically.</div>`;
      return;
    }
    const cards = snap.cards || [];
    const cardsHtml = cards.length === 0
      ? `<div style="color:#94a3b8;font-size:12px;padding:8px 0;">No cards detected yet. Wait for the page to finish loading.</div>`
      : cards.map((c, idx) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px;background:#f8fafc;">
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:13px;">
              ${c.display_string}
              ${c.is_primary ? '<span style="background:#dcfce7;color:#15803d;font-size:10px;padding:2px 6px;border-radius:5px;margin-left:6px;">Default</span>' : ''}
              ${c.is_backup ? '<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:2px 6px;border-radius:5px;margin-left:6px;">Backup</span>' : ''}
            </div>
            ${c.exp_month && c.exp_year ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px;">Exp ${c.exp_month}/${c.exp_year}</div>` : ''}
          </div>
          ${c.removable ? `<button data-card-idx="${idx}" class="dsl-crm-remove-card" style="background:#fff;border:1px solid #ef4444;color:#ef4444;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:600;">Remove</button>` : `<span style="color:#cbd5e1;font-size:10px;">no id</span>`}
        </div>
      `).join("");

    body.innerHTML = `
      <div style="font-weight:700;font-size:11px;color:#94a3b8;margin-bottom:8px;letter-spacing:0.5px;">ACCOUNT act_${accId}</div>
      ${row("Status", snap.account_status)}
      ${row("Account type", snap.account_type)}
      ${row("Timezone", snap.timezone_name)}
      ${row("Currency", snap.currency)}
      <div style="height:8px;"></div>
      ${row("Visible limit (cap)", cur(snap.visible_limit, snap.currency))}
      ${row("Hidden daily limit", cur(snap.hidden_daily_limit, snap.currency), { accent: true })}
      ${row("Billing threshold", cur(snap.billing_threshold, snap.currency))}
      ${row("Balance", cur(snap.balance, snap.currency))}
      ${row("Outstanding", cur(snap.outstanding_balance, snap.currency))}
      ${row("Total spending", cur(snap.total_spending, snap.currency), { accent: true })}
      <div style="margin-top:14px;font-weight:700;font-size:12px;color:#475569;letter-spacing:0.4px;">PAYMENT METHODS</div>
      ${cardsHtml}
    `;
    body.querySelectorAll(".dsl-crm-remove-card").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const idx = Number(btn.getAttribute("data-card-idx"));
        const card = snap.cards[idx];
        if (!card) return;
        if (!confirm(`Remove ${card.display_string} from act_${snap.account_id}?\n\nEta direct Meta GraphQL e mutation pathabe.`)) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = "Removing…";
        try {
          const res = await chrome.runtime.sendMessage({
            type: "remove-card-graphql",
            payload: {
              accountId: snap.account_id,
              cardId: card.id,
              card,
              creds: state.creds,
              pageUrl: location.href,
            },
          });
          if (!res?.ok) throw new Error(res?.error || "Failed");
          btn.style.color = "#15803d";
          btn.style.borderColor = "#15803d";
          btn.textContent = "Removed ✓";
          setStatus("Card removed via Meta GraphQL.", "ok");
          setTimeout(() => location.reload(), 1500);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = orig;
          setStatus("Remove failed: " + (err?.message || err), "error");
        }
      });
    });
  }

  function setStatus(text, kind = "info") {
    state.statusText = text;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const el = panel.querySelector("#dsl-crm-status");
    if (!el) return;
    el.style.color =
      kind === "error" ? "#ef4444" : kind === "ok" ? "#059669" : "#64748b";
    el.textContent = text;
  }

  // ---------------- listen to hook ----------------
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "dsl-hook") return;
    if (data.type === "ready") {
      setStatus("Hook installed. Waiting for Meta GraphQL traffic…");
      return;
    }
    if (data.type === "creds") {
      state.creds = data.payload;
      const has = !!(state.creds?.fb_dtsg && state.creds?.lsd);
      if (has) setStatus("Captured Meta credentials. Live data ready.", "ok");
      return;
    }
    if (data.type === "graphql") {
      try {
        if (data.payload?.accountId) state.accountId = data.payload.accountId;
        extractFromGraphqlText(data.payload.text);
      } catch (e) {
        console.warn("[DSL] extract failed", e);
      }
    }
  });

  // Also handle messages from CRM web app (sync-single-account)
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "dsl-crm") return;
    if (event.data?.type === "sync-single-account") {
      const requestId = event.data.requestId;
      const accountId = event.data.accountId;
      chrome.runtime.sendMessage({ type: "sync-single-account", accountId }, (response) => {
        window.postMessage({ source: "dsl-extension", type: "sync-single-account-result", requestId, response }, "*");
      });
    }
    if (event.data?.type === "ping") {
      window.postMessage({ source: "dsl-extension", type: "pong" }, "*");
    }
  });

  // ---------------- background → content (collect snapshot) ----------------
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "collect-billing-snapshot") {
      pushToCRM(true)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
      return true;
    }
  });

  // ---------------- push to CRM ----------------
  async function pushToCRM(force = false) {
    if (!state.snapshot || !state.snapshot.account_id) {
      setStatus("No snapshot yet — open the billing page first.", "error");
      return;
    }
    const key = JSON.stringify({
      a: state.snapshot.account_id,
      h: state.snapshot.hidden_daily_limit,
      l: state.snapshot.visible_limit,
      t: state.snapshot.billing_threshold,
      s: state.snapshot.total_spending,
      c: (state.snapshot.cards || []).map((c) => c.id).sort(),
    });
    if (!force && key === state.lastSyncedKey) {
      setStatus("Already up to date with CRM.", "ok");
      return;
    }
    setStatus("Syncing to CRM…");
    try {
      const res = await chrome.runtime.sendMessage({
        type: "push-billing-snapshot",
        payload: state.snapshot,
      });
      if (!res?.ok) throw new Error(res?.error || "Sync failed");
      state.lastSyncedKey = key;
      setStatus(`Synced to CRM at ${new Date().toLocaleTimeString()}`, "ok");
    } catch (err) {
      setStatus("CRM sync failed: " + (err?.message || err), "error");
    }
  }

  // ---------------- bootstrap ----------------
  function start() {
    if (!BILLING_RE.test(location.pathname)) return;
    state.accountId = getAccountIdFromUrl();
    ensurePanel();
    renderPanel();
    // Re-render on URL changes (SPA)
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) {
        last = location.href;
        const newId = getAccountIdFromUrl();
        if (newId !== state.accountId) {
          state.accountId = newId;
          state.raw = { cards: null, threshold: null, limit: null, account: null };
          state.snapshot = null;
          renderPanel();
        }
      }
    }, 1500);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
