// ============================================================
//  DSL Sync — Content script (v2.1.0)
//  - Injects hook.js into page MAIN world
//  - Listens for captured creds + GraphQL responses + replay results
//  - DOM fallback for cards / threshold / DSL / balance so panel
//    matches the visible Meta billing page exactly
//  - Renders the floating "Ads Check by CRM" panel (480px draggable)
//  - Card removal: prefer captured GraphQL mutation replay
//    (page-context, real fb_dtsg) → fallback to clicking visible
//    Meta UI Remove button → confirmation dialog confirm
//  - Smart sync: waits for snapshot to be populated before pushing
//    to CRM
// ============================================================
(() => {
  if (window.__DSL_CONTENT_INSTALLED__) return;
  window.__DSL_CONTENT_INSTALLED__ = true;

  const BILLING_RE = /\/billing_hub\/(accounts|payment_methods)\b/;
  const PANEL_ID = "dsl-crm-panel";

  // -------- inject hook --------
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

  // -------- state --------
  const state = {
    creds: null,
    accountId: null,
    snapshot: null,
    raw: { cardsById: new Map(), threshold: null, dsl: null, balance: null, account: {} },
    dom: { cards: [], threshold: null, dsl: null, balance: null, current_balance: null, funds: null },
    capturedOps: new Set(), // friendly_names seen
    lastSyncedKey: "",
    statusText: "Waiting for billing data…",
    pendingReplays: new Map(),
  };

  // -------- helpers --------
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
    return `${Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })} ${c || "USD"}`;
  }

  function money(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "object") {
      const a = Number(v.amount ?? v.value ?? 0);
      const off = Number(v.offset || v.currency_offset || 0);
      if (!Number.isFinite(a)) return null;
      return off > 1 ? a / off : a;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function parseMoneyText(t) {
    if (!t) return null;
    const m = String(t).replace(/[, ]/g, "").match(/[$£€¥₹]?\s*(-?\d+(?:\.\d{1,2})?)/);
    return m ? Number(m[1]) : null;
  }

  // -------- GraphQL response extraction --------
  function safeParse(text) {
    if (!text) return null;
    const cleaned = text.replace(/^for \(;;\);/, "").trim();
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      try { return JSON.parse(cleaned); } catch {}
    }
    const out = [];
    for (const line of cleaned.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch {}
    }
    return out.length ? out : null;
  }

  function walk(node, visitor, depth = 0) {
    if (!node || depth > 14) return;
    if (Array.isArray(node)) { for (const v of node) walk(v, visitor, depth + 1); return; }
    if (typeof node === "object") {
      visitor(node);
      for (const k in node) walk(node[k], visitor, depth + 1);
    }
  }

  function decodeNodeId(rawId) {
    const s = String(rawId || "").trim();
    if (!s) return s;
    // Base64-looking GraphQL node id: try to extract numeric tail like
    // "credit_card_<digits>" / "fundingsource_<digits>" so it merges with
    // the numeric id branch returns from other queries.
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 8) {
      try {
        const decoded = atob(s);
        const m = decoded.match(/(\d{8,})\s*$/);
        if (m) return m[1];
      } catch {}
    }
    return s;
  }
  function normalizeCardNode(obj) {
    const last4 =
      obj.last_four_digits ||
      obj.credit_card_last_four ||
      (obj.display_string && (obj.display_string.match(/(\d{4})\s*$/) || [])[1]) ||
      null;
    // STRICT: must have a real 4-digit last4. Drops BM-wide / archived
    // payment_method nodes whose only "id" is a base64 GraphQL node id
    // (e.g. "...MzU=") — those were leaking into the panel as fake cards.
    if (!last4 || !/^\d{4}$/.test(String(last4))) return null;
    const brand = (
      obj.credit_card_type || obj.type || obj.payment_method_type ||
      (obj.display_string && (obj.display_string.match(/^([A-Za-z ]+?)\s+/) || [])[1]) || ""
    ).toString().trim().toLowerCase().replace(/\s+/g, "");
    const rawId = String(
      obj.id || obj.payment_method_id || obj.funding_source_id || obj.credit_card_id || "",
    ).trim();
    const id = decodeNodeId(rawId);
    if (!id || /^\d{1,4}$/.test(id)) return null;
    return {
      id,
      display_string: `${(brand || "card").toUpperCase()} *${last4}`,
      type: brand || "card",
      last4,
      exp_month: obj.exp_month || obj.expiration_month || null,
      exp_year: obj.exp_year || obj.expiration_year || null,
      is_primary: !!(obj.is_primary || obj.is_default || obj.default_method),
      is_backup: !!(obj.is_backup || obj.is_secondary),
      removable: true,
      source: "graphql",
    };
  }

  function extractFromGraphqlText(text) {
    const data = safeParse(text);
    if (!data) return;
    const accountId = state.accountId || getAccountIdFromUrl();
    walk(data, (obj) => {
      if (
        (obj.__typename && /PaymentMethod|CreditCard|FundingSource/i.test(obj.__typename)) ||
        (obj.display_string && (obj.credit_card_number || obj.last_four_digits || obj.exp_month || obj.payment_method_id))
      ) {
        const c = normalizeCardNode(obj);
        if (c) {
          const prev = state.raw.cardsById.get(c.id);
          state.raw.cardsById.set(c.id, { ...prev, ...c, is_primary: !!(prev?.is_primary || c.is_primary) });
        }
      }
      if (obj.threshold_amount || obj.billing_threshold) {
        const t = money(obj.threshold_amount || obj.billing_threshold);
        if (t) state.raw.threshold = t;
      }
      if (obj.amount_due) {
        const a = money(obj.amount_due);
        if (a !== null) state.raw.balance = a;
      }
      if (obj.account_status || obj.timezone_name || obj.adtrust_dsl || obj.amount_spent || obj.balance) {
        const a = state.raw.account;
        if (obj.account_status) a.account_status = obj.account_status;
        if (obj.account_status_string) a.account_status = obj.account_status_string;
        if (obj.timezone_name) a.timezone_name = obj.timezone_name;
        if (obj.account_type) a.account_type = obj.account_type;
        if (obj.currency) a.currency = obj.currency;
        const dsl = money(obj.adtrust_dsl);
        if (dsl) state.raw.dsl = dsl;
        const minDb = money(obj.min_daily_budget);
        if (minDb && !state.raw.dsl) state.raw.dsl = minDb;
        if (obj.amount_spent !== undefined) a.amount_spent = money(obj.amount_spent);
        if (obj.balance !== undefined) {
          const b = money(obj.balance);
          if (b !== null) a.balance = b;
        }
        if (obj.spend_cap !== undefined) a.spend_cap = money(obj.spend_cap);
        if (obj.outstanding_balance !== undefined) a.outstanding_balance = money(obj.outstanding_balance);
      }
    });
    rebuildSnapshot(accountId);
    renderPanel();
  }

  // -------- DOM extraction (matches the visible billing page) --------
  function parseDom() {
    try {
      const txt = (document.body?.innerText || "").replace(/\s+/g, " ");

      // Threshold: "Your balance reaches $301.00" / "$1,234.00"
      let m = txt.match(/balance\s+reaches\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
      if (m) state.dom.threshold = Number(m[1].replace(/,/g, ""));

      // Hidden DSL: "Daily spending limit (set by Meta): $295.70"
      m = txt.match(/daily\s+spending\s+limit\s*(?:\(set by Meta\))?\s*:\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
      if (m) state.dom.dsl = Number(m[1].replace(/,/g, ""));

      // Current balance "Current balance $86.86"
      m = txt.match(/current\s+balance\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
      if (m) state.dom.current_balance = Number(m[1].replace(/,/g, ""));

      // Funds amount "Funds $120.00"
      m = txt.match(/\bFunds\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
      if (m) state.dom.funds = Number(m[1].replace(/,/g, ""));

      // -------- DOM cards (Payment methods section) --------
      // We look for the "Payment methods" heading and then collect rows with last-4 digits.
      const cards = [];
      const seen = new Set();
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,span"))
        .filter((el) => /^\s*Payment methods\s*$/i.test(el.textContent || ""));
      const sections = headings.length ? headings.map((h) => h.closest("section,div,article") || h.parentElement) : [document.body];
      for (const section of sections) {
        if (!section) continue;
        const rows = Array.from(section.querySelectorAll("li,[role='listitem'],div"));
        for (const row of rows) {
          const t = (row.innerText || "").replace(/\s+/g, " ").trim();
          if (!t || t.length > 200) continue;
          // Look for "Visa •••• 7144" or "Visa **** 7144" or "Visa ⋯⋯ 7144" or "Mastercard ... 1234"
          const cm = t.match(/(visa|mastercard|amex|american express|discover|paypal|jcb|unionpay|maestro)\b[^0-9]{0,18}(\d{4})\b/i);
          if (!cm) continue;
          const brand = cm[1].toLowerCase().replace(/\s+/g, "");
          const last4 = cm[2];
          const key = `${brand}:${last4}`;
          if (seen.has(key)) continue;
          // skip rows that contain multiple cards (parent containers)
          const cardMatches = (t.match(/(?:visa|mastercard|amex|american express|discover|paypal|jcb|unionpay|maestro)\b[^0-9]{0,18}\d{4}\b/gi) || []).length;
          if (cardMatches > 1) continue;
          seen.add(key);
          const isDefault = /\bDefault\b/i.test(t);
          const expMatch = t.match(/Expires\s+(\d{1,2})\/(\d{2,4})/i);
          // Find the row's "..." menu / "Remove" button — used by UI fallback.
          const buttons = Array.from(row.querySelectorAll('button,[role="button"]'));
          const hasMenu = buttons.some((b) => /more|menu|options|⋯|…/i.test(`${b.textContent || ""} ${b.getAttribute("aria-label") || ""}`));
          cards.push({
            id: `dom:${brand}:${last4}`,
            display_string: `${brand[0].toUpperCase() + brand.slice(1)} •••• ${last4}`,
            type: brand,
            last4,
            exp_month: expMatch ? Number(expMatch[1]) : null,
            exp_year: expMatch ? Number(expMatch[2].length === 2 ? `20${expMatch[2]}` : expMatch[2]) : null,
            is_primary: isDefault,
            is_backup: false,
            removable: hasMenu,
            source: "dom",
            row_text: t.slice(0, 120),
          });
        }
      }
      state.dom.cards = cards;
    } catch (e) {
      console.warn("[DSL] DOM parse failed", e);
    }
  }

  function rebuildSnapshot(accountId) {
    parseDom();
    const acc = state.raw.account || {};
    const gqlCards = Array.from(state.raw.cardsById.values());
    // Merge: prefer GraphQL cards (real ids); enrich with DOM (last4 ↔ id),
    // then fill in missing DOM-only cards so the panel matches the page.
    const byKey = new Map(); // key by last4+brand for cross-source merge
    function keyOf(c) { return `${(c.type || "card").toLowerCase()}:${c.last4 || ""}`; }
    for (const c of gqlCards) {
      const k = keyOf(c);
      byKey.set(k, { ...c });
    }
    for (const dc of state.dom.cards) {
      const k = keyOf(dc);
      const existing = byKey.get(k);
      if (existing) {
        existing.is_primary = existing.is_primary || dc.is_primary;
        existing.exp_month = existing.exp_month || dc.exp_month;
        existing.exp_year = existing.exp_year || dc.exp_year;
        existing.removable = existing.removable || dc.removable;
        existing.row_text = dc.row_text;
        existing.display_string = existing.display_string || dc.display_string;
      } else {
        byKey.set(k, { ...dc });
      }
    }
    const cards = Array.from(byKey.values()).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));

    const dsl = state.dom.dsl ?? state.raw.dsl ?? null;
    const threshold = state.dom.threshold ?? state.raw.threshold ?? null;
    const balance = state.dom.current_balance ?? acc.balance ?? state.raw.balance ?? null;

    state.snapshot = {
      account_id: accountId || state.accountId,
      currency: acc.currency || "USD",
      account_status: acc.account_status || null,
      account_type: acc.account_type || null,
      timezone_name: acc.timezone_name || null,
      visible_limit: acc.spend_cap || null,
      hidden_daily_limit: dsl,
      billing_threshold: threshold,
      outstanding_balance: acc.outstanding_balance || null,
      balance,
      funds: state.dom.funds || null,
      total_spending: acc.amount_spent || null,
      cards,
      parsed_at: new Date().toISOString(),
      source_url: location.href,
      captured_ops: Array.from(state.capturedOps),
    };
  }

  // -------- panel UI --------
  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: "fixed", top: "70px", right: "20px", width: "480px",
      maxHeight: "88vh", overflowY: "auto",
      background: "#ffffff", color: "#0f172a",
      border: "1px solid #e2e8f0", borderRadius: "14px",
      boxShadow: "0 18px 48px rgba(15,23,42,0.28)",
      zIndex: "2147483646",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "14px", lineHeight: "1.55",
    });
    panel.innerHTML = `
      <div id="dsl-crm-head" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-radius:14px 14px 0 0;cursor:move;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:16px;">📊</div>
          <div>
            <div style="font-weight:700;font-size:16px;line-height:1.1;">Ads Check by CRM</div>
            <div style="font-size:11px;opacity:0.9;" id="dsl-crm-subhead">v2.1.0</div>
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

  function row(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9;">
      <span style="color:#64748b;font-size:12px;">${label}</span>
      <span style="font-size:13px;text-align:right;">${value}</span>
    </div>`;
  }

  function rowAccent(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9;">
      <span style="color:#64748b;font-size:12px;">${label}</span>
      <span style="color:#059669;font-weight:700;font-size:14px;text-align:right;">${value}</span>
    </div>`;
  }

  function renderPanel() {
    const panel = ensurePanel();
    const body = panel.querySelector("#dsl-crm-body");
    const sub = panel.querySelector("#dsl-crm-subhead");
    const snap = state.snapshot;
    const accId = (snap && snap.account_id) || state.accountId || getAccountIdFromUrl();
    if (sub) sub.textContent = accId ? `act_${accId}` : "v2.1.0";
    if (!snap || !accId) {
      body.innerHTML = `<div style="color:#94a3b8;padding:8px 0;">Open an ad account on the Billing page. Live data will appear here.</div>`;
      return;
    }
    const cards = snap.cards || [];
    const cardsHtml = cards.length === 0
      ? `<div style="color:#94a3b8;font-size:12px;padding:8px 0;">No cards detected yet. Wait a moment for the page to load.</div>`
      : cards.map((c, idx) => {
          const canRemove = c.removable;
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px;background:#f8fafc;">
              <div style="min-width:0;">
                <div style="font-weight:600;font-size:13px;">
                  ${c.display_string}
                  ${c.is_primary ? '<span style="background:#dcfce7;color:#15803d;font-size:10px;padding:2px 6px;border-radius:5px;margin-left:6px;">Default</span>' : ''}
                  ${c.is_backup ? '<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:2px 6px;border-radius:5px;margin-left:6px;">Backup</span>' : ''}
                </div>
                ${c.exp_month && c.exp_year ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px;">Exp ${c.exp_month}/${c.exp_year}</div>` : ''}
              </div>
              ${canRemove
                ? `<button data-card-idx="${idx}" class="dsl-crm-remove-card" style="background:#fff;border:1px solid #ef4444;color:#ef4444;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:600;">Remove</button>`
                : `<span title="No remove action available" style="color:#cbd5e1;font-size:10px;">no remove</span>`
              }
            </div>
          `;
        }).join("");

    body.innerHTML = `
      <div style="font-weight:700;font-size:11px;color:#94a3b8;margin-bottom:8px;letter-spacing:0.5px;">ACCOUNT act_${accId}</div>
      ${row("Status", snap.account_status)}
      ${row("Account type", snap.account_type)}
      ${row("Timezone", snap.timezone_name)}
      ${row("Currency", snap.currency)}
      <div style="height:8px;"></div>
      ${rowAccent("Hidden daily limit", cur(snap.hidden_daily_limit, snap.currency))}
      ${row("Billing threshold", cur(snap.billing_threshold, snap.currency))}
      ${row("Visible limit (cap)", cur(snap.visible_limit, snap.currency))}
      ${row("Current balance", cur(snap.balance, snap.currency))}
      ${row("Funds", cur(snap.funds, snap.currency))}
      ${row("Outstanding", cur(snap.outstanding_balance, snap.currency))}
      ${rowAccent("Total spending", cur(snap.total_spending, snap.currency))}
      <div style="margin-top:14px;font-weight:700;font-size:12px;color:#475569;letter-spacing:0.4px;">PAYMENT METHODS (${cards.length})</div>
      ${cardsHtml}
    `;
    body.querySelectorAll(".dsl-crm-remove-card").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-card-idx"));
        const card = snap.cards[idx];
        if (!card) return;
        if (!confirm(`Remove ${card.display_string} from act_${snap.account_id}?\n\nThis will use the same Remove flow as Meta's billing page.`)) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = "Removing…";
        try {
          const ok = await removeCard(card);
          if (!ok.ok) throw new Error(ok.error || "Failed");
          btn.style.color = "#15803d";
          btn.style.borderColor = "#15803d";
          btn.textContent = "Removed ✓";
          setStatus(`Card removed (${ok.via}).`, "ok");
          // Refresh page state from Meta
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
    el.style.color = kind === "error" ? "#ef4444" : kind === "ok" ? "#059669" : "#64748b";
    el.textContent = text;
  }

  // -------- card removal --------
  async function replayOp(friendly_name, override_variables, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const reqId = `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const t = setTimeout(() => {
        state.pendingReplays.delete(reqId);
        resolve({ ok: false, error: "replay_timeout" });
      }, timeoutMs);
      state.pendingReplays.set(reqId, (res) => { clearTimeout(t); resolve(res); });
      window.postMessage({ source: "dsl-content", type: "replay-op", reqId, friendly_name, override_variables }, "*");
    });
  }

  // Try a list of likely Meta delete/remove mutation names that we may have captured on this account.
  const REMOVE_OP_NAMES = [
    "BillingPaymentMethodDeleteMutation",
    "useBillingRemovePaymentMethodMutation",
    "BillingHubRemovePaymentMethodMutation",
    "BillingHubPaymentMethodDeleteMutation",
    "BillingPaymentMethodsRemovePaymentMethodMutation",
    "PaymentMethodDeleteMutation",
  ];

  async function tryReplayRemove(card) {
    if (!card.id || card.id.startsWith("dom:")) return { ok: false, error: "no_real_id" };
    for (const name of REMOVE_OP_NAMES) {
      if (!state.capturedOps.has(name)) continue;
      const res = await replayOp(name, {
        input: {
          payment_method_id: card.id,
          payment_account_id: state.snapshot?.account_id,
          ad_account_id: state.snapshot?.account_id,
          actor_id: state.creds?.__user || "0",
          client_mutation_id: "1",
        },
      });
      if (!res.ok) continue;
      let json = null;
      try { json = JSON.parse((res.body || "").replace(/^for \(;;\);/, "")); } catch {}
      const hasErr = json && (json.errors || json.error);
      if (json && !hasErr) return { ok: true, via: `replay:${name}` };
    }
    return { ok: false, error: "no_captured_remove_op" };
  }

  // Fallback: click the visible Meta UI Remove flow on the matching card row.
  async function tryUiRemove(card) {
    const last4 = card.last4 || (card.display_string || "").match(/(\d{4})\s*$/)?.[1];
    if (!last4) return { ok: false, error: "no_last4_for_ui_match" };
    const panel = document.getElementById(PANEL_ID);
    const isVisible = (el) => {
      if (!el || (panel && panel.contains(el))) return false;
      const s = window.getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8;
    };
    const all = Array.from(document.querySelectorAll('li,[role="listitem"],div')).filter(isVisible);
    const row = all.find((el) => {
      const t = (el.innerText || "");
      if (t.length > 240) return false;
      if (!t.includes(last4)) return false;
      const cardMatches = (t.match(/\b\d{4}\b/g) || []).length;
      return cardMatches <= 2; // last4 + maybe expiry year
    });
    if (!row) return { ok: false, error: "row_not_found" };
    // Find the menu button ("...") inside the row
    const buttons = Array.from(row.querySelectorAll('button,[role="button"]')).filter(isVisible);
    const menu = buttons.find((b) => /more|menu|options|⋯|…|ellipsis/i.test(`${b.textContent || ""} ${b.getAttribute("aria-label") || ""}`));
    if (menu) menu.click();
    await new Promise((r) => setTimeout(r, 800));
    // Find "Remove" entry anywhere visible (menu opens in a portal)
    const removeBtn = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],a'))
      .filter(isVisible)
      .find((b) => /^\s*(remove|delete|detach)\s*$/i.test((b.textContent || "").trim()));
    if (!removeBtn) return { ok: false, error: "remove_option_not_found" };
    removeBtn.click();
    // Confirmation dialog
    await new Promise((r) => setTimeout(r, 800));
    const confirmBtn = Array.from(document.querySelectorAll('button,[role="button"]'))
      .filter(isVisible)
      .find((b) => /^\s*(remove|confirm|delete|yes,?\s*remove)\s*$/i.test((b.textContent || "").trim()));
    if (confirmBtn) confirmBtn.click();
    return { ok: true, via: "ui_click" };
  }

  async function removeCard(card) {
    // 1) Try captured GraphQL mutation replay (clean, server-verified)
    const r = await tryReplayRemove(card);
    if (r.ok) return r;
    // 2) Fallback: visible Meta UI flow
    const u = await tryUiRemove(card);
    if (u.ok) return u;
    return { ok: false, error: r.error === "no_captured_remove_op" ? "Remove mutation not yet captured. Open the card menu once on the page so Meta loads its delete query, then try again." : (u.error || r.error || "Failed") };
  }

  // -------- listen to hook --------
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;

    if (data.source === "dsl-hook") {
      if (data.type === "ready") { setStatus("Hook installed. Waiting for Meta GraphQL traffic…"); return; }
      if (data.type === "creds") {
        state.creds = data.payload;
        if (state.creds?.fb_dtsg && state.creds?.lsd) setStatus("Captured Meta credentials. Live data ready.", "ok");
        return;
      }
      if (data.type === "graphql") {
        try {
          if (data.payload?.accountId) state.accountId = data.payload.accountId;
          if (data.payload?.friendly_name) state.capturedOps.add(data.payload.friendly_name);
          extractFromGraphqlText(data.payload.text);
        } catch (e) {
          console.warn("[DSL] extract failed", e);
        }
        return;
      }
      if (data.type === "ops-list") {
        for (const op of data.payload?.ops || []) state.capturedOps.add(op);
        return;
      }
      if (data.type === "replay-op-result") {
        const cb = state.pendingReplays.get(data.payload?.reqId);
        if (cb) { state.pendingReplays.delete(data.payload.reqId); cb(data.payload); }
        return;
      }
      return;
    }

    if (data.source === "dsl-crm") {
      if (data.type === "sync-single-account") {
        const requestId = data.requestId;
        const accountId = data.accountId;
        chrome.runtime.sendMessage({ type: "sync-single-account", accountId }, (response) => {
          window.postMessage({ source: "dsl-extension", type: "sync-single-account-result", requestId, response }, "*");
        });
      }
      if (data.type === "ping") {
        window.postMessage({ source: "dsl-extension", type: "pong" }, "*");
      }
    }
  });

  // -------- background → content (smart collect) --------
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "collect-billing-snapshot") {
      collectAndPush(msg.timeoutMs || 25000)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
      return true;
    }
  });

  function snapshotIsReady(snap) {
    if (!snap || !snap.account_id) return false;
    // Need at least: hidden_daily_limit OR billing_threshold OR cards present.
    if ((snap.cards?.length || 0) > 0) return true;
    if (snap.hidden_daily_limit || snap.billing_threshold || snap.balance) return true;
    return false;
  }

  async function collectAndPush(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      parseDom();
      rebuildSnapshot(state.accountId || getAccountIdFromUrl());
      if (snapshotIsReady(state.snapshot)) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    if (!snapshotIsReady(state.snapshot)) {
      return { ok: false, error: "Billing data not visible on this page yet." };
    }
    return await pushToCRM(true);
  }

  // -------- push to CRM --------
  async function pushToCRM(force = false) {
    if (!state.snapshot || !state.snapshot.account_id) {
      setStatus("No snapshot yet — open the billing page first.", "error");
      return { ok: false, error: "no_snapshot" };
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
      return { ok: true, skipped: true };
    }
    setStatus("Syncing to CRM…");
    try {
      const res = await chrome.runtime.sendMessage({ type: "push-billing-snapshot", payload: state.snapshot });
      if (!res?.ok) throw new Error(res?.error || "Sync failed");
      state.lastSyncedKey = key;
      setStatus(`Synced to CRM at ${new Date().toLocaleTimeString()}`, "ok");
      return { ok: true };
    } catch (err) {
      setStatus("CRM sync failed: " + (err?.message || err), "error");
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // -------- bootstrap --------
  function start() {
    if (!BILLING_RE.test(location.pathname)) return;
    state.accountId = getAccountIdFromUrl();
    ensurePanel();
    parseDom();
    rebuildSnapshot(state.accountId);
    renderPanel();
    // Re-parse DOM periodically so values update as React re-renders the page.
    setInterval(() => {
      parseDom();
      rebuildSnapshot(state.accountId || getAccountIdFromUrl());
      renderPanel();
      // Auto-push to CRM once per account per page session as soon as we have
      // at least one real GraphQL-id card. Avoids relying on the unreliable
      // background mass-sync — we capture passively while the user is on the
      // billing page (Smit-style).
      try {
        const snap = state.snapshot;
        const hasRealCard = !!snap?.cards?.some((c) => c?.id && !String(c.id).startsWith("dom:"));
        if (hasRealCard && state.lastSyncedKey === "" && !state.__autoPushing) {
          state.__autoPushing = true;
          pushToCRM(false).finally(() => { state.__autoPushing = false; });
        }
      } catch {}
    }, 2000);
    // Detect SPA route changes
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) {
        last = location.href;
        const newId = getAccountIdFromUrl();
        if (newId !== state.accountId) {
          state.accountId = newId;
          state.raw = { cardsById: new Map(), threshold: null, dsl: null, balance: null, account: {} };
          state.dom = { cards: [], threshold: null, dsl: null, balance: null, current_balance: null, funds: null };
          state.snapshot = null;
          renderPanel();
        }
      }
    }, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
