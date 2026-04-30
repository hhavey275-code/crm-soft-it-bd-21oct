// ============================================================
//  DSL Sync — content script (v1.4.0)
//  SMIT-style live panel on Facebook Billing pages
//  - Parses billing page DOM for: visible limit, hidden daily limit,
//    threshold, balance, total spending, account type, timezone, cards.
//  - Renders a floating right-side "Ads Check by CRM" panel.
//  - Lets admins remove a card with the active Facebook session.
//  - Pushes the parsed snapshot to backend (ingest-dsl) for the
//    matching CRM ad account.
// ============================================================

(() => {
  const BILLING_RE = /\/billing_hub\/(accounts|payment_methods)\b/;
  const PANEL_ID = "dsl-crm-panel";
  let lastSnapshotKey = "";
  let pushTimer = null;

  // ---------- helpers ----------
  function getAccountId() {
    try {
      const u = new URL(location.href);
      const a = u.searchParams.get("asset_id") || u.searchParams.get("payment_account_id") || u.searchParams.get("account_id") || u.searchParams.get("act");
      if (a) return String(a).replace(/^act_/, "");
    } catch {}
    const m = location.href.match(/act[_=](\d{6,})/);
    return m ? m[1] : null;
  }

  function parseMoney(str) {
    if (!str) return null;
    const m = String(str).replace(/,/g, "").match(/([\d]+(?:\.[\d]+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  function parseCurrency(str) {
    const m = String(str || "").match(/\b([A-Z]{3})\b/);
    return m ? m[1] : null;
  }

  function pageText() {
    return document.body ? (document.body.innerText || "") : "";
  }

  // Find the value that follows a label using a flexible regex.
  function findAfter(label, opts = {}) {
    const text = pageText();
    const flags = "i";
    const lbl = opts.regex ? label : label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Allow up to 80 chars (whitespace/newlines) between label and number, optional currency
    const re = new RegExp(lbl + "[^\\n]{0,80}?([A-Z]{0,3}\\s*\\$?\\s*[0-9][0-9,]*(?:\\.[0-9]+)?\\s*(?:USD|BDT|EUR|GBP)?)", flags);
    const m = text.match(re);
    if (!m) return null;
    const raw = m[1];
    return { raw, value: parseMoney(raw), currency: parseCurrency(raw) };
  }

  // ---------- parse billing snapshot ----------
  function parseSnapshot() {
    const text = pageText();
    if (!text) return null;

    const dsl = findAfter("Daily spending limit\\s*\\(set by Meta\\)", { regex: true }) || findAfter("Daily spending limit");
    const threshold = findAfter("Your balance reaches") || findAfter("Threshold");
    const outstanding = findAfter("Outstanding balance") || findAfter("Outstanding");
    const balance = findAfter("Balance");
    const totalSpending = findAfter("Total spending");
    const limit = findAfter("\\bLimit\\b", { regex: true });
    const hiddenLimit = findAfter("Hidden Limit");

    // Account status — look for "Active", "Disabled", "USD | Active"
    let status = null;
    const statusMatch = text.match(/Account['']?s status[^\n]{0,40}?([A-Z]{3}\s*\|?\s*[A-Za-z]+)/i);
    if (statusMatch) status = statusMatch[1].trim();

    // Account type
    let accountType = null;
    const typeMatch = text.match(/Account type[^\n]{0,40}?(Personal Account|Business|Agency Account|Personal)/i);
    if (typeMatch) accountType = typeMatch[1].trim();

    // Timezone
    let timezone = null;
    const tzMatch = text.match(/Timezone[^\n]{0,40}?([+\-]?\d{1,2}\s*\|\s*[A-Za-z_/]+|[A-Za-z_]+\/[A-Za-z_]+)/);
    if (tzMatch) timezone = tzMatch[1].trim();

    // Currency
    let currency = "USD";
    const curMatch = text.match(/\b(USD|BDT|EUR|GBP|INR|VND|IDR|THB|PHP|MYR|SGD|CAD|AUD)\b/);
    if (curMatch) currency = curMatch[1];

    // Cards from "Payment methods" section
    const cards = parseCards();

    // Hidden limit fallback: from screenshot SMIT shows actual cap as
    // "Daily spending limit (set by Meta)". If hidden_limit not labeled,
    // use that DSL number as the hidden cap.
    const hiddenVal = (hiddenLimit && hiddenLimit.value) || (dsl && dsl.value) || null;
    const visibleLimit = (limit && limit.value) || null;

    return {
      account_id: getAccountId(),
      currency,
      account_status: status,
      account_type: accountType,
      timezone_name: timezone,
      visible_limit: visibleLimit,
      hidden_daily_limit: hiddenVal,
      billing_threshold: threshold ? threshold.value : null,
      outstanding_balance: outstanding ? outstanding.value : null,
      balance: balance ? balance.value : null,
      total_spending: totalSpending ? totalSpending.value : null,
      cards,
      parsed_at: new Date().toISOString(),
      source_url: location.href,
    };
  }

  function parseCards() {
    const cards = [];
    const seen = new Set();
    // Heuristic: look for any element whose text matches "Visa ... 1234" / "MasterCard ... 1234"
    const cardRe = /(VISA|Visa|MasterCard|Master Card|MASTERCARD|American Express|Discover|JCB|UnionPay)\s*[·•\-\u00b7\u2022]*\s*\.{0,4}\s*(\d{4})/;
    const expRe = /Expires?\s*(\d{1,2})\s*[\/\-]\s*(\d{2,4})/i;
    const els = document.querySelectorAll('div, li, [role="listitem"]');
    for (const el of els) {
      const t = el.textContent || "";
      if (t.length > 600) continue;
      const m = t.match(cardRe);
      if (!m) continue;
      const last4 = m[2];
      const brand = m[1].replace(/\s+/g, "").toLowerCase();
      const key = `${brand}-${last4}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const expM = t.match(expRe);
      const isDefault = /\bDefault\b/i.test(t);
      const isBackup = /\bBackup\b/i.test(t);

      // Try to extract a numeric funding-source/payment-method id from inner HTML
      let fsId = null;
      const html = (el.outerHTML || "").slice(0, 12000);
      const idM = html.match(/payment_method[s]?\/(\d{6,})/) ||
                  html.match(/funding_source_id["'\s:=]+(\d{6,})/) ||
                  html.match(/(?:paymentMethodID|payment_method_id|paymentMethodId|fundingSourceID|funding_source_id)["'\s:=]+["']?(\d{6,})/) ||
                  html.match(/data-(?:payment-method-id|funding-source-id)="(\d{6,})"/);
      if (idM) fsId = idM[1];
      // Synthetic id when Meta doesn't expose the numeric id in the DOM
      const id = fsId || `local:${brand}:${last4}`;

      cards.push({
        id,
        removal_hint: fsId ? null : { brand, last4 },
        display_string: `${m[1].toUpperCase()} *${last4}`,
        type: brand,
        is_primary: isDefault,
        is_backup: isBackup,
        exp_month: expM ? parseInt(expM[1], 10) : null,
        exp_year: expM ? parseInt(expM[2].length === 2 ? "20" + expM[2] : expM[2], 10) : null,
      });
    }
    // sort default → others
    return cards.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  }

  // ---------- panel UI ----------
  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: "fixed",
      top: "80px",
      right: "16px",
      width: "320px",
      maxHeight: "80vh",
      overflowY: "auto",
      background: "#ffffff",
      color: "#0f172a",
      border: "1px solid #e2e8f0",
      borderRadius: "10px",
      boxShadow: "0 10px 30px rgba(15,23,42,0.18)",
      zIndex: "2147483646",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "12px",
      lineHeight: "1.4",
    });
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-radius:10px 10px 0 0;">
        <div style="font-weight:700;font-size:13px;">📊 Ads Check by CRM</div>
        <div style="display:flex;gap:6px;">
          <button id="dsl-crm-sync" title="Sync to CRM" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;">Sync</button>
          <button id="dsl-crm-collapse" title="Hide" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;">_</button>
        </div>
      </div>
      <div id="dsl-crm-body" style="padding:10px 12px;"></div>
      <div id="dsl-crm-status" style="padding:6px 12px;font-size:11px;color:#64748b;border-top:1px solid #f1f5f9;">Parsing…</div>
    `;
    document.documentElement.appendChild(panel);
    panel.querySelector("#dsl-crm-collapse").addEventListener("click", () => {
      const body = panel.querySelector("#dsl-crm-body");
      const status = panel.querySelector("#dsl-crm-status");
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      status.style.display = hidden ? "block" : "none";
    });
    panel.querySelector("#dsl-crm-sync").addEventListener("click", () => {
      pushSnapshot(true);
    });
    return panel;
  }

  function row(label, value, opts = {}) {
    if (value === null || value === undefined || value === "") return "";
    const accent = opts.accent ? "color:#059669;font-weight:700;" : "";
    return `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9;">
      <span style="color:#64748b;">${label}</span>
      <span style="${accent}text-align:right;">${value}</span>
    </div>`;
  }

  function fmtMoney(v, cur) {
    if (v === null || v === undefined) return null;
    const c = cur || "USD";
    return `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
  }

  function renderPanel(snap) {
    const panel = ensurePanel();
    const body = panel.querySelector("#dsl-crm-body");
    if (!snap || !snap.account_id) {
      body.innerHTML = `<div style="color:#94a3b8;">Open an ad account on the Billing page to see live data.</div>`;
      return;
    }

    const cardsHtml = snap.cards.length === 0
      ? `<div style="color:#94a3b8;font-size:11px;padding:6px 0;">No cards detected on this page.</div>`
      : snap.cards.map((c, idx) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;margin-top:6px;background:#f8fafc;">
          <div style="min-width:0;">
            <div style="font-weight:600;">${c.display_string}${c.is_primary ? ' <span style="background:#dcfce7;color:#15803d;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:4px;">Default</span>' : ''}${c.is_backup ? ' <span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:4px;">Backup</span>' : ''}</div>
            ${c.exp_month && c.exp_year ? `<div style="color:#94a3b8;font-size:10px;">Exp ${c.exp_month}/${c.exp_year}</div>` : ''}
          </div>
          <button data-card-id="${c.id}" data-card-index="${idx}" class="dsl-crm-remove-card" style="background:#fff;border:1px solid #ef4444;color:#ef4444;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:10px;font-weight:600;">Remove</button>
        </div>
      `).join("");

    body.innerHTML = `
      <div style="font-weight:700;font-size:11px;color:#94a3b8;margin-bottom:6px;">act_${snap.account_id}</div>
      ${row("Account's status", snap.account_status)}
      ${row("Limit", fmtMoney(snap.visible_limit, snap.currency))}
      ${row("Hidden Limit", fmtMoney(snap.hidden_daily_limit, snap.currency), { accent: true })}
      ${row("Threshold", fmtMoney(snap.billing_threshold, snap.currency))}
      ${row("Balance", fmtMoney(snap.balance, snap.currency))}
      ${row("Outstanding", fmtMoney(snap.outstanding_balance, snap.currency))}
      ${row("Total spending", fmtMoney(snap.total_spending, snap.currency))}
      ${row("Account type", snap.account_type)}
      ${row("Timezone", snap.timezone_name)}
      <div style="margin-top:10px;font-weight:600;font-size:11px;color:#64748b;">Payment methods</div>
      ${cardsHtml}
    `;

    // Wire remove buttons
    body.querySelectorAll(".dsl-crm-remove-card").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cardId = btn.getAttribute("data-card-id");
        const cardIndex = Number(btn.getAttribute("data-card-index"));
        const card = Number.isFinite(cardIndex) ? snap.cards[cardIndex] : null;
        if (!confirm(`Remove this card from act_${snap.account_id}?`)) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = "Removing…";
        try {
          const res = await chrome.runtime.sendMessage({
            type: "remove-card",
            payload: { accountId: snap.account_id, fundingSourceId: cardId, card },
          });
          if (!res?.ok) throw new Error(res?.error || "Failed");
          btn.style.color = "#15803d";
          btn.style.borderColor = "#15803d";
          btn.textContent = "Removed ✓";
          setTimeout(() => location.reload(), 1200);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = orig;
          alert("Remove failed: " + (err?.message || err));
        }
      });
    });
  }

  function setStatus(msg, kind = "info") {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const el = panel.querySelector("#dsl-crm-status");
    if (!el) return;
    const color = kind === "error" ? "#ef4444" : kind === "ok" ? "#059669" : "#64748b";
    el.style.color = color;
    el.textContent = msg;
  }

  // ---------- push to backend ----------
  async function pushSnapshot(force = false) {
    const snap = parseSnapshot();
    if (!snap || !snap.account_id) {
      renderPanel(snap);
      setStatus("No account detected on this page.", "error");
      return;
    }
    renderPanel(snap);
    const key = JSON.stringify({
      a: snap.account_id, h: snap.hidden_daily_limit, l: snap.visible_limit,
      t: snap.billing_threshold, c: snap.cards.map((c) => c.id).sort(),
    });
    if (!force && key === lastSnapshotKey) {
      setStatus("Already up to date with CRM.", "ok");
      return;
    }
    setStatus("Syncing to CRM…");
    try {
      const res = await chrome.runtime.sendMessage({
        type: "push-billing-snapshot",
        payload: snap,
      });
      if (!res?.ok) throw new Error(res?.error || "Sync failed");
      lastSnapshotKey = key;
      setStatus(`Synced to CRM ${new Date().toLocaleTimeString()}`, "ok");
    } catch (err) {
      setStatus("CRM sync failed: " + (err?.message || err), "error");
    }
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushSnapshot(false), 2500);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "collect-billing-snapshot") {
      pushSnapshot(true)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
      return true;
    }
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "dsl-crm") return;
    if (event.data?.type === "run-billing-sweep") {
      chrome.runtime.sendMessage({ type: "run-billing-sweep", reason: event.data.reason || "crm" }, (response) => {
        window.postMessage({ source: "dsl-extension", type: "billing-sweep-result", response }, "*");
      });
    }
  });

  // ---------- bootstrap ----------
  function start() {
    if (!BILLING_RE.test(location.pathname)) return;
    ensurePanel();
    schedulePush();
    const obs = new MutationObserver(() => {
      schedulePush();
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    // Re-run when SPA navigation changes the URL
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastSnapshotKey = "";
        schedulePush();
      }
    }, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
