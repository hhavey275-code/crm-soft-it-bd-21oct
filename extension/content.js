// ============================================================
//  DSL Sync — content script (v1.3.0)
//  - Marker on Ads Manager tabs (token-extraction is from popup/bg)
//  - On billing_hub account-details pages, inject a small "Remove (CRM)"
//    button next to each payment method so admins can detach a card
//    using their own Facebook session — same flow as SMIT.vn extension.
// ============================================================

console.debug("[DSL Sync] content script loaded");

const BILLING_PATH_RE = /\/billing_hub\/(accounts|payment_methods)\b/;

function getAccountIdFromUrl() {
  try {
    const u = new URL(location.href);
    const asset = u.searchParams.get("asset_id") || u.searchParams.get("account_id");
    if (asset) return String(asset).replace(/^act_/, "");
  } catch {}
  return null;
}

function findFundingSourceId(rowEl) {
  // Walk DOM/data attributes for a numeric funding_source-like id
  let el = rowEl;
  for (let i = 0; i < 6 && el; i++) {
    const txt = el.getAttribute && (el.getAttribute("data-funding-source-id") || el.getAttribute("data-payment-method-id"));
    if (txt) return txt;
    el = el.parentElement;
  }
  // Last resort: scan inner HTML for fb_payment_method id pattern
  const html = (rowEl.outerHTML || "").slice(0, 4000);
  const m = html.match(/payment_method[s]?\/(\d{6,})/) || html.match(/funding_source_id["':\s]+(\d{6,})/);
  return m ? m[1] : null;
}

function injectRemoveButton(row) {
  if (row.querySelector(".dsl-crm-remove")) return;
  const btn = document.createElement("button");
  btn.textContent = "Remove (CRM)";
  btn.className = "dsl-crm-remove";
  Object.assign(btn.style, {
    marginLeft: "8px",
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: "600",
    borderRadius: "6px",
    border: "1px solid #ef4444",
    background: "#fff",
    color: "#ef4444",
    cursor: "pointer",
  });
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accountId = getAccountIdFromUrl();
    const fundingSourceId = findFundingSourceId(row);
    if (!accountId || !fundingSourceId) {
      alert("Could not detect account or card id. Open the card details once, then retry.");
      return;
    }
    if (!confirm(`Remove this card from act_${accountId}?`)) return;
    btn.disabled = true;
    btn.textContent = "Removing...";
    try {
      const res = await chrome.runtime.sendMessage({
        type: "remove-card",
        payload: { accountId, fundingSourceId },
      });
      if (!res?.ok) throw new Error(res?.error || "Failed");
      btn.textContent = "Removed ✓";
      btn.style.color = "#16a34a";
      btn.style.borderColor = "#16a34a";
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Remove (CRM)";
      alert("Remove failed: " + (err?.message || err));
    }
  });
  row.appendChild(btn);
}

function scanBillingPage() {
  if (!BILLING_PATH_RE.test(location.pathname)) return;
  // Heuristic: rows that contain card brand text + masked digits
  const candidates = document.querySelectorAll('div[role="listitem"], li, [data-testid*="payment"], [data-testid*="funding"]');
  for (const row of candidates) {
    const txt = (row.textContent || "").trim();
    if (!txt) continue;
    if (/(Visa|MasterCard|Master Card|American Express|Discover|JCB|UnionPay)\s*[·•\-]\s*\d{2,4}/i.test(txt) || /\u2022{2,}\s*\d{4}/.test(txt)) {
      injectRemoveButton(row);
    }
  }
}

if (BILLING_PATH_RE.test(location.pathname)) {
  // Initial pass + observe DOM changes (FB renders async)
  setTimeout(scanBillingPage, 1500);
  const obs = new MutationObserver(() => scanBillingPage());
  obs.observe(document.body, { childList: true, subtree: true });
}
