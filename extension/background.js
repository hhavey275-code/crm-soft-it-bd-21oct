// ============================================================
//  DSL Sync — Background Service Worker (v1.4.0)
//  - Auto-sync every 6 hours (only CRM-managed accounts)
//  - Accepts billing-page snapshots from content.js (SMIT-style)
//  - Performs card removal using the user's Facebook session
//  - Survives popup close / tab switching (runs in service worker)
// ============================================================

const ALARM_NAME = "auto-sync";
const SYNC_INTERVAL_MINUTES = 360; // every 6 hours

const getStored = (keys) => new Promise((res) => chrome.storage.local.get(keys, res));
const setStored = (obj) => new Promise((res) => chrome.storage.local.set(obj, res));
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------- Supabase token refresh ----------
async function refreshSupabaseToken(apiUrl, anonKey, refreshToken) {
  const url = `${apiUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.msg || "Token refresh failed");
  return { access_token: body.access_token, refresh_token: body.refresh_token };
}

// ---------- FB tab + token extraction ----------
async function findFbTab() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://business.facebook.com/*",
      "https://www.facebook.com/adsmanager/*",
      "https://adsmanager.facebook.com/*",
    ],
  });
  return tabs[0] || null;
}

async function openFbTab() {
  return new Promise((resolve) => {
    chrome.tabs.create(
      { url: "https://business.facebook.com/adsmanager/manage/accounts", active: false },
      (tab) => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => resolve(tab), 4000);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      },
    );
  });
}

async function openBillingTab(accountId) {
  const actId = String(accountId).replace(/^act_/, "");
  return new Promise((resolve) => {
    chrome.tabs.create(
      { url: `https://business.facebook.com/billing_hub/accounts/details?asset_id=${actId}`, active: false },
      (tab) => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => resolve(tab), 4500);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      },
    );
  });
}

async function sendTabMessage(tabId, message, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
}

async function extractFbAccessToken(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const tokens = new Set();
      const patterns = [/EAAG\w{50,}/g, /EAAB\w{50,}/g, /EAA[A-Za-z0-9]{80,}/g];
      const sources = [];
      for (const s of document.querySelectorAll("script")) {
        if (s.textContent) sources.push(s.textContent);
      }
      try { sources.push(document.documentElement.outerHTML); } catch {}
      for (const src of sources) {
        for (const re of patterns) {
          let m;
          while ((m = re.exec(src)) !== null) {
            let tok = m[0].replace(/["'\\,;}\]].*$/, "");
            if (tok.length >= 80) tokens.add(tok);
          }
        }
      }
      const sorted = Array.from(tokens).sort((a, b) => b.length - a.length);
      return { token: sorted[0] || null, candidates: sorted.length };
    },
  });
  return result;
}

// ---------- Card / account normalization ----------
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
  for (const c of [...existing, ...incoming]) {
    if (!c?.id) continue;
    const prev = byId.get(c.id);
    byId.set(c.id, { ...prev, ...c, is_primary: !!(prev?.is_primary || c.is_primary) });
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
  const pmList = Array.isArray(acc?.payment_methods?.data) ? acc.payment_methods.data : [];
  for (const pm of pmList) {
    const card = normalizeCard(pm, false);
    if (card) cards.push(card);
  }
  return mergeCards([], cards);
}
function deriveHiddenLimit(acc) {
  const candidates = [];
  const push = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) candidates.push(n);
  };
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

async function fetchOneAccount(accountId, accessToken) {
  const actId = String(accountId).replace(/^act_/, "");
  const url = `https://graph.facebook.com/v19.0/act_${actId}?fields=${ACCOUNT_FIELDS}&access_token=${encodeURIComponent(accessToken)}`;
  try {
    const res = await fetchWithTimeout(url, 15000);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) return null;
    body.account_id = actId;
    return normalizeFromAccount(body);
  } catch { return null; }
}
async function fetchManagedAccountsData(accountIds, accessToken) {
  const results = [];
  for (const batch of chunk(accountIds, 8)) {
    const data = await Promise.all(batch.map((id) => fetchOneAccount(id, accessToken)));
    for (const r of data) if (r) results.push(r);
  }
  return results;
}

// ---------- Backend calls ----------
async function callBackend(apiUrl, anonKey, jwt, refreshToken, path, payload) {
  const url = `${apiUrl.replace(/\/$/, "")}/functions/v1/${path}`;
  const doFetch = async (token) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anonKey },
      body: JSON.stringify(payload || {}),
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  };
  let { res, body } = await doFetch(jwt);
  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshSupabaseToken(apiUrl, anonKey, refreshToken);
    await setStored({ jwt: refreshed.access_token, refreshToken: refreshed.refresh_token });
    ({ res, body } = await doFetch(refreshed.access_token));
  }
  if (!res.ok) throw new Error(body.error || `${path} failed (${res.status})`);
  return body;
}

// ---------- Main auto-sync (Graph API, scheduled) ----------
async function runAutoSync(reason = "alarm") {
  const stored = await getStored([
    "apiUrl", "anonKey", "jwt", "refreshToken", "userEmail", "autoSyncEnabled",
  ]);
  if (stored.autoSyncEnabled === false) return { skipped: true, reason: "disabled" };
  if (!stored.apiUrl || !stored.anonKey || !stored.jwt) return { skipped: true, reason: "not-logged-in" };

  await setStored({ lastSyncStatus: "running", lastSyncAt: Date.now(), lastSyncReason: reason });

  try {
    const managed = await callBackend(stored.apiUrl, stored.anonKey, stored.jwt, stored.refreshToken, "list-managed-accounts", {});
    const accountIds = managed.account_ids || [];
    if (!accountIds.length) throw new Error("No CRM-managed Meta accounts");

    let tab = await findFbTab();
    let opened = false;
    if (!tab) { tab = await openFbTab(); opened = true; }

    let token = null, info = null;
    for (let i = 0; i < 3 && !token; i++) {
      info = await extractFbAccessToken(tab.id).catch(() => null);
      token = info?.token || null;
      if (!token) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!token) throw new Error(`No Facebook token (scanned ${info?.candidates ?? 0})`);

    const accounts = await fetchManagedAccountsData(accountIds, token);
    if (!accounts.length) throw new Error("Could not fetch any managed accounts");

    const result = await callBackend(stored.apiUrl, stored.anonKey, stored.jwt, stored.refreshToken, "ingest-dsl", { accounts });
    if (opened) { try { await chrome.tabs.remove(tab.id); } catch {} }

    await setStored({
      lastSyncStatus: "success",
      lastSyncAt: Date.now(),
      lastSyncSaved: result.saved,
      lastSyncReceived: result.received,
      lastSyncError: null,
    });
    return { ok: true, ...result };
  } catch (err) {
    const message = err?.message || String(err);
    await setStored({ lastSyncStatus: "error", lastSyncAt: Date.now(), lastSyncError: message });
    console.warn("[DSL auto-sync] failed:", message);
    return { ok: false, error: message };
  }
}

async function runBillingSweep(reason = "crm") {
  const stored = await getStored(["apiUrl", "anonKey", "jwt", "refreshToken"]);
  if (!stored.apiUrl || !stored.anonKey || !stored.jwt) return { ok: false, error: "Not logged in to CRM extension" };
  await setStored({ lastSyncStatus: "running", lastSyncAt: Date.now(), lastSyncReason: reason });
  try {
    const managed = await callBackend(stored.apiUrl, stored.anonKey, stored.jwt, stored.refreshToken, "list-managed-accounts", {});
    const accountIds = (managed.account_ids || []).slice(0, 60);
    if (!accountIds.length) throw new Error("No CRM-managed Meta accounts");
    let saved = 0;
    const failed = [];
    for (const accountId of accountIds) {
      let tab = null;
      try {
        tab = await openBillingTab(accountId);
        const res = await sendTabMessage(tab.id, { type: "collect-billing-snapshot" });
        if (res?.ok) saved += 1;
        else failed.push({ accountId, error: res?.error || "snapshot failed" });
      } catch (err) {
        failed.push({ accountId, error: err?.message || String(err) });
      } finally {
        if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    await setStored({ lastSyncStatus: failed.length ? "partial" : "success", lastSyncAt: Date.now(), lastSyncSaved: saved, lastSyncError: failed[0]?.error || null });
    return { ok: true, saved, attempted: accountIds.length, failed };
  } catch (err) {
    const message = err?.message || String(err);
    await setStored({ lastSyncStatus: "error", lastSyncAt: Date.now(), lastSyncError: message });
    return { ok: false, error: message };
  }
}

// ---------- Billing-page snapshot from content.js ----------
async function pushBillingSnapshot(snap) {
  const stored = await getStored(["apiUrl", "anonKey", "jwt", "refreshToken"]);
  if (!stored.apiUrl || !stored.anonKey || !stored.jwt) {
    throw new Error("Not logged in to CRM. Open the extension popup and log in.");
  }
  if (!snap || !snap.account_id) throw new Error("No account id in snapshot");

  // Convert content-script snapshot into the shape ingest-dsl expects.
  const cards = (snap.cards || []).filter((c) => c && c.id && !String(c.id).startsWith("local:")).map((c) => ({
    id: String(c.id),
    display_string: c.display_string,
    type: c.type,
    is_primary: !!c.is_primary,
    exp_month: c.exp_month ?? null,
    exp_year: c.exp_year ?? null,
  }));

  const account = {
    account_id: snap.account_id,
    name: undefined,
    currency: snap.currency || "USD",
    daily_spend_limit: snap.visible_limit ?? 0,
    hidden_daily_limit: snap.hidden_daily_limit ?? 0,
    cards,
    billing_snapshot: {
      account_status: snap.account_status ?? null,
      account_type: snap.account_type ?? null,
      timezone_name: snap.timezone_name ?? null,
      billing_threshold: snap.billing_threshold ?? null,
      outstanding_balance: snap.outstanding_balance ?? null,
      balance: snap.balance ?? null,
      total_spending: snap.total_spending ?? null,
      raw_url: snap.source_url ?? null,
      parsed_at: snap.parsed_at,
    },
  };
  return await callBackend(stored.apiUrl, stored.anonKey, stored.jwt, stored.refreshToken, "ingest-dsl", { accounts: [account], source: "billing_page" });
}

// ---------- Card removal ----------
async function removeCardFromAccount({ accountId, fundingSourceId }) {
  let tab = await findFbTab();
  if (!tab) tab = await openFbTab();
  let token = null;
  for (let i = 0; i < 3 && !token; i++) {
    const info = await extractFbAccessToken(tab.id).catch(() => null);
    token = info?.token || null;
    if (!token) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!token) throw new Error("Could not get Facebook access token");
  const actId = String(accountId).replace(/^act_/, "");
  const url = `https://graph.facebook.com/v19.0/act_${actId}/payment_methods/${encodeURIComponent(fundingSourceId)}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    throw new Error(body?.error?.message || `Remove failed (${res.status})`);
  }
  return { ok: true };
}

// ---------- Alarms / messaging ----------
async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: SYNC_INTERVAL_MINUTES });
  }
}
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runAutoSync("alarm");
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "run-auto-sync") {
    runAutoSync(msg.reason || "manual").then(sendResponse);
    return true;
  }
  if (msg?.type === "ensure-alarm") {
    ensureAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "remove-card") {
    removeCardFromAccount(msg.payload || {})
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "push-billing-snapshot") {
    pushBillingSnapshot(msg.payload)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
