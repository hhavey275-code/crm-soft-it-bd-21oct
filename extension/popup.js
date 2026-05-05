// ============================================================
//  DSL Sync — popup logic
//  Workflow:
//   1. User saves app URL + Supabase anon key + admin login
//   2. We login to Supabase (email/password) → get JWT
//   3. To sync: open/find a Facebook Ads Manager tab, extract the
//      user's session-bound access token from the page, then call
//      Graph API /me/adaccounts?fields=account_id,name,adtrust_dsl,currency
//   4. POST results to <app-url>/functions/v1/ingest-dsl
// ============================================================

const $ = (id) => document.getElementById(id);
const setStatus = (msg, kind = "info") => {
  const el = $("status");
  el.textContent = msg;
  el.className = `status show ${kind}`;
  if (kind === "success") setTimeout(() => el.classList.remove("show"), 4000);
};
const clearStatus = () => $("status").classList.remove("show");

async function getStored(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res));
}
async function setStored(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res));
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// ---------- Supabase auth ----------
async function supabaseLogin(apiUrl, anonKey, email, password) {
  const url = `${apiUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.msg || "Login failed");
  return { access_token: body.access_token, refresh_token: body.refresh_token, user: body.user };
}

// ---------- Facebook access token extraction ----------
// Facebook Ads Manager exposes the user's ads access token in the page DOM
// inside a script tag with the property "accessToken" or in a global. We
// find an Ads Manager tab and execute a script to read it.
async function findAdsManagerTab() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://business.facebook.com/*",
      "https://www.facebook.com/adsmanager/*",
      "https://adsmanager.facebook.com/*",
    ],
  });
  return tabs[0] || null;
}

async function openAdsManagerTab() {
  return new Promise((resolve) => {
    chrome.tabs.create(
      { url: "https://business.facebook.com/adsmanager/manage/accounts", active: false },
      (tab) => {
        // wait for the tab to fully load
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            // give the page extra time for scripts to populate the token
            setTimeout(() => resolve(tab), 4000);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      },
    );
  });
}

async function extractFbAccessToken(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      // Scan EVERYTHING — script tags, inline JSON, and the full HTML —
      // for tokens. Facebook keeps moving where the token lives so we
      // try many patterns and pick the longest valid-looking one.
      const tokens = new Set();
      const patterns = [
        /EAAG\w{50,}/g,          // Graph API user tokens often start with EAAG
        /EAAB\w{50,}/g,          // Some BM tokens
        /EAA[A-Za-z0-9]{80,}/g,  // Generic long EAA token
      ];
      const sources = [];
      // 1. All script tags
      for (const s of document.querySelectorAll("script")) {
        if (s.textContent) sources.push(s.textContent);
      }
      // 2. Full HTML (catches tokens in attributes, JSON islands, etc.)
      try { sources.push(document.documentElement.outerHTML); } catch {}
      // 3. window.__additionalDataLoaded / require payloads if available
      try {
        if (window.require) {
          // not directly readable, skip
        }
      } catch {}

      for (const src of sources) {
        for (const re of patterns) {
          let m;
          while ((m = re.exec(src)) !== null) {
            // Strip trailing punctuation like ", \, etc.
            let tok = m[0].replace(/["'\\,;}\]].*$/, "");
            if (tok.length >= 80) tokens.add(tok);
          }
        }
      }
      const sorted = Array.from(tokens).sort((a, b) => b.length - a.length);
      return {
        token: sorted[0] || null,
        candidates: sorted.length,
        url: location.href,
      };
    },
  });
  return result;
}

// ---------- Graph API: per-account fetch (managed-only) ----------
function normalizeCard(source, isPrimary = false) {
  if (!source) return null;
  const id = String(source.id || source.funding_source_id || "").trim();
  if (!id) return null;
  return {
    id,
    display_string: source.display_string || source.name || `Card ...${id.slice(-4)}`,
    type: source.type || source.card_type || "unknown",
    is_primary: !!isPrimary,
    exp_month: source.exp_month || null,
    exp_year: source.exp_year || null,
  };
}

function mergeCards(existing = [], incoming = []) {
  const byId = new Map();
  for (const card of [...existing, ...incoming]) {
    if (!card?.id) continue;
    const prev = byId.get(card.id);
    byId.set(card.id, { ...prev, ...card, is_primary: !!(prev?.is_primary || card.is_primary) });
  }
  return Array.from(byId.values()).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
}

function extractAccountCards(acc) {
  const cards = [];
  const primary = normalizeCard(acc?.funding_source_details, true);
  if (primary) cards.push(primary);
  const cycles = Array.isArray(acc?.adspaymentcycle?.data) ? acc.adspaymentcycle.data : [];
  for (const cycle of cycles) {
    const card = normalizeCard(cycle?.funding_source_details, false);
    if (card) cards.push(card);
  }
  const pm = Array.isArray(acc?.payment_methods?.data) ? acc.payment_methods.data : [];
  for (const p of pm) {
    const card = normalizeCard(p, false);
    if (card) cards.push(card);
  }
  return mergeCards([], cards);
}

function deriveHiddenLimit(acc) {
  const candidates = [];
  const push = (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) candidates.push(n); };
  push(acc?.adtrust_dsl);
  push(acc?.min_daily_budget);
  const cycles = Array.isArray(acc?.adspaymentcycle?.data) ? acc.adspaymentcycle.data : [];
  for (const c of cycles) { push(c?.threshold_amount); push(c?.amount_due); }
  return candidates.length ? Math.min(...candidates) : 0;
}

function deriveBillingThreshold(acc) {
  const candidates = [];
  const cycles = Array.isArray(acc?.adspaymentcycle?.data) ? acc.adspaymentcycle.data : [];
  for (const c of cycles) {
    const n = Number(c?.threshold_amount);
    if (Number.isFinite(n) && n > 0) candidates.push(n);
  }
  return candidates.length ? Math.max(...candidates) : 0;
}

function normalizeFromAccount(acc) {
  const dsl = Number(acc?.adtrust_dsl);
  const threshold = deriveBillingThreshold(acc);
  return {
    account_id: String(acc.account_id || acc.id || "").replace(/^act_/, ""),
    name: acc?.name,
    daily_spend_limit: Number.isFinite(dsl) && dsl > 0 ? dsl : 0,
    hidden_daily_limit: deriveHiddenLimit(acc),
    currency: acc?.currency || "USD",
    cards: extractAccountCards(acc),
    billing_snapshot: {
      billing_threshold: threshold || null,
      balance: Number(acc?.balance) || null,
      total_spending: Number(acc?.amount_spent) || null,
    },
  };
}

async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

const ACCOUNT_FIELDS =
  "account_id,name,currency,adtrust_dsl,min_daily_budget,balance,amount_spent,spend_cap," +
  "funding_source_details," +
  "adspaymentcycle{funding_source_details,threshold_amount,amount_due}," +
  "payment_methods";
const ACCOUNT_FIELDS_SAFE =
  "account_id,name,currency,adtrust_dsl,min_daily_budget,balance,amount_spent,spend_cap," +
  "funding_source_details," +
  "adspaymentcycle{funding_source_details,threshold_amount,amount_due}";

async function fetchOneAccount(accountId, accessToken) {
  const actId = String(accountId).replace(/^act_/, "");
  const makeUrl = (fields) => `https://graph.facebook.com/v19.0/act_${actId}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;
  try {
    let res = await fetchWithTimeout(makeUrl(ACCOUNT_FIELDS), 15000);
    let body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      res = await fetchWithTimeout(makeUrl(ACCOUNT_FIELDS_SAFE), 15000);
      body = await res.json().catch(() => ({}));
    }
    if (!res.ok || body?.error) return null;
    body.account_id = actId;
    return normalizeFromAccount(body);
  } catch { return null; }
}

async function fetchManagedAccountsData(accountIds, accessToken, onProgress) {
  const results = [];
  let done = 0;
  for (const batch of chunk(accountIds, 8)) {
    const batchData = await Promise.all(batch.map((id) => fetchOneAccount(id, accessToken)));
    for (const r of batchData) if (r) results.push(r);
    done += batch.length;
    if (onProgress) onProgress(`Fetched ${done}/${accountIds.length} accounts...`);
  }
  return results;
}

// ---------- Send to backend ----------
async function listManagedAccounts(apiUrl, anonKey, jwt) {
  const url = `${apiUrl.replace(/\/$/, "")}/functions/v1/list-managed-accounts`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: anonKey },
    body: "{}",
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Could not load managed accounts");
  return body.account_ids || [];
}

async function ingestDsl(apiUrl, anonKey, jwt, accounts) {
  const url = `${apiUrl.replace(/\/$/, "")}/functions/v1/ingest-dsl`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: anonKey },
    body: JSON.stringify({ accounts }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Ingest failed");
  return body;
}

// ---------- UI flows ----------
async function showMainView(email) {
  $("setup-view").classList.add("hidden");
  $("main-view").classList.remove("hidden");
  $("user-email").textContent = email;
}

async function showSetupView(stored) {
  $("setup-view").classList.remove("hidden");
  $("main-view").classList.add("hidden");
  if (stored.apiUrl) $("api-url").value = stored.apiUrl;
  if (stored.anonKey) $("anon-key").value = stored.anonKey;
  if (stored.email) $("email").value = stored.email;
}

async function init() {
  const stored = await getStored(["apiUrl", "anonKey", "email", "jwt", "userEmail"]);
  if (stored.jwt && stored.userEmail) {
    await showMainView(stored.userEmail);
    await refreshAutoSyncUi();
  } else {
    await showSetupView(stored);
  }
}

$("login-btn").addEventListener("click", async () => {
  const apiUrl = $("api-url").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;
  const anonKey = $("anon-key").value.trim();
  if (!apiUrl || !email || !password || !anonKey) {
    setStatus("Fill in all fields", "error");
    return;
  }
  $("login-btn").disabled = true;
  setStatus("Logging in...", "info");
  try {
    const result = await supabaseLogin(apiUrl, anonKey, email, password);
    await setStored({
      apiUrl,
      anonKey,
      email,
      jwt: result.access_token,
      refreshToken: result.refresh_token,
      userEmail: result.user?.email || email,
    });
    setStatus("Logged in!", "success");
    await showMainView(result.user?.email || email);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    $("login-btn").disabled = false;
  }
});

$("logout-btn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["jwt", "refreshToken", "userEmail"]);
  clearStatus();
  await init();
});

$("sync-btn").addEventListener("click", async () => {
  const stored = await getStored(["apiUrl", "anonKey", "jwt"]);
  if (!stored.jwt) {
    setStatus("Please login again", "error");
    return;
  }
  $("sync-btn").disabled = true;
  $("progress-wrap").classList.remove("hidden");
  $("results").innerHTML = "";
  $("progress-bar").style.width = "0%";
  $("progress-text").textContent = "Looking for Facebook tab...";
  clearStatus();

  try {
    $("progress-text").textContent = "Loading CRM-managed accounts...";
    $("progress-bar").style.width = "10%";
    const managedIds = await listManagedAccounts(stored.apiUrl, stored.anonKey, stored.jwt);
    if (!managedIds.length) throw new Error("No Meta ad accounts found in your CRM.");

    let tab = await findAdsManagerTab();
    if (!tab) {
      $("progress-text").textContent = "Opening Ads Manager (background)...";
      $("progress-bar").style.width = "20%";
      tab = await openAdsManagerTab();
    }
    $("progress-text").textContent = "Extracting Facebook access token...";
    $("progress-bar").style.width = "35%";

    let token = null;
    let lastInfo = null;
    for (let i = 0; i < 4 && !token; i++) {
      const info = await extractFbAccessToken(tab.id);
      lastInfo = info;
      token = info?.token || null;
      if (!token) {
        if (i === 1) {
          try { await chrome.tabs.reload(tab.id); } catch {}
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
    }
    if (!token) {
      throw new Error(
        `Could not find Facebook access token (scanned ${lastInfo?.candidates ?? 0} candidates). ` +
        `Open https://business.facebook.com/adsmanager/manage/accounts in a NEW tab, wait until it loads, then click Sync again.`,
      );
    }

    $("progress-text").textContent = `Fetching ${managedIds.length} CRM accounts from Facebook...`;
    $("progress-bar").style.width = "55%";
    const accounts = await fetchManagedAccountsData(managedIds, token, (msg) => {
      $("progress-text").textContent = msg;
    });
    if (accounts.length === 0) {
      throw new Error("Could not fetch any managed accounts (check Facebook permissions).");
    }

    $("progress-text").textContent = `Sending ${accounts.length} accounts to your dashboard...`;
    $("progress-bar").style.width = "85%";
    const result = await ingestDsl(stored.apiUrl, stored.anonKey, stored.jwt, accounts);

    $("progress-bar").style.width = "100%";
    $("progress-text").textContent = `Done — saved ${result.saved} of ${result.received}.`;
    setStatus(`Synced ${result.saved} ad accounts. ${result.unmatched.length} not in dashboard.`, "success");

    // Render details
    const withDsl = accounts.filter((a) => a.daily_spend_limit > 0);
    const html = withDsl
      .slice(0, 50)
      .map(
        (a) => `<div class="row">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${escapeHtml(a.name || a.account_id)}</div>
          <div>${a.currency} ${a.daily_spend_limit.toFixed(2)}</div>
        </div>`,
      )
      .join("");
    $("results").innerHTML = html || `<div class="muted">No accounts had a Daily Spending Limit set.</div>`;
  } catch (err) {
    setStatus(err.message, "error");
    $("progress-text").textContent = "Failed.";
  } finally {
    $("sync-btn").disabled = false;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Auto-sync UI ----------
function timeAgo(ts) {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`;
  return `${Math.floor(sec / 86400)} day(s) ago`;
}

async function refreshAutoSyncUi() {
  const s = await getStored([
    "autoSyncEnabled",
    "lastSyncStatus",
    "lastSyncAt",
    "lastSyncSaved",
    "lastSyncReceived",
    "lastSyncError",
  ]);
  const enabled = s.autoSyncEnabled !== false; // default ON
  const toggle = $("auto-sync-toggle");
  if (toggle) {
    toggle.checked = enabled;
    $("auto-sync-label").textContent = enabled ? "On" : "Off";
  }
  const statusEl = $("auto-sync-status");
  if (!statusEl) return;
  if (!enabled) {
    statusEl.textContent = "Disabled";
    return;
  }
  const when = timeAgo(s.lastSyncAt);
  if (s.lastSyncStatus === "success") {
    statusEl.textContent = `Last: ${when} · saved ${s.lastSyncSaved}/${s.lastSyncReceived}`;
  } else if (s.lastSyncStatus === "error") {
    statusEl.textContent = `Last: ${when} · error: ${(s.lastSyncError || "").slice(0, 60)}`;
  } else if (s.lastSyncStatus === "running") {
    statusEl.textContent = `Running... (started ${when})`;
  } else {
    statusEl.textContent = "Waiting for first run";
  }
}

const autoSyncToggleEl = $("auto-sync-toggle");
if (autoSyncToggleEl) {
  // v1.4.2: background sweep removed. Toggle is informational only.
  autoSyncToggleEl.checked = false;
  autoSyncToggleEl.disabled = true;
  const lbl = $("auto-sync-label");
  if (lbl) lbl.textContent = "Per-account sync (use CRM Sync button)";
}

// ---------- Process pending client sync requests ----------
async function refreshPendingCount() {
  const el = $("pending-count");
  if (!el) return;
  const stored = await getStored(["apiUrl", "anonKey", "jwt"]);
  if (!stored.jwt) { el.textContent = ""; return; }
  try {
    const url = `${stored.apiUrl.replace(/\/$/, "")}/functions/v1/list-pending-sync-requests`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${stored.jwt}`, apikey: stored.anonKey },
      body: "{}",
    });
    const body = await res.json().catch(() => ({}));
    const n = body?.count || 0;
    el.textContent = n ? `${n} pending client sync request(s)` : "No pending client sync requests";
  } catch { el.textContent = ""; }
}
refreshPendingCount();
setInterval(refreshPendingCount, 30000);

const processBtn = $("process-pending-btn");
if (processBtn) {
  processBtn.addEventListener("click", async () => {
    processBtn.disabled = true;
    setStatus("Processing pending requests…", "info");
    try {
      const r = await chrome.runtime.sendMessage({ type: "process-pending-sync-requests" });
      if (r?.ok) setStatus(`Done — synced ${r.done || 0}, failed ${r.failed || 0}`, "success");
      else setStatus(r?.error || "Failed", "error");
      refreshPendingCount();
    } finally { processBtn.disabled = false; }
  });
}

setInterval(() => { refreshAutoSyncUi().catch(() => {}); }, 5000);

init();