// ============================================================
//  DSL Sync — Background Service Worker (v1.3.0)
//  - Hourly auto-sync
//  - Only syncs accounts that exist in the CRM (via list-managed-accounts)
//  - Sends both adtrust_dsl (visible limit) and hidden_daily_limit
//  - Pulls payment cards for each managed account
// ============================================================

const ALARM_NAME = "auto-sync";
const SYNC_INTERVAL_MINUTES = 60;

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
      return { token: sorted[0] || null, candidates: sorted.length, url: location.href };
    },
  });
  return result;
}

// ---------- Card normalization ----------
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
  // Also try payment_methods edge if present (extra payment methods listed on billing)
  const pmList = Array.isArray(acc?.payment_methods?.data) ? acc.payment_methods.data : [];
  for (const pm of pmList) {
    const card = normalizeCard(pm, false);
    if (card) cards.push(card);
  }
  return mergeCards([], cards);
}

// ---------- Hidden limit derivation ----------
// Meta exposes the visible "Daily spending limit" via adtrust_dsl.
// The real *hidden* cap (what the SMIT extension shows as "Hidden Limit")
// is typically the lower of: adtrust_dsl, min_daily_budget-derived caps,
// or the threshold/balance pair. We pick the most restrictive positive
// number from these signals.
function deriveHiddenLimit(acc) {
  const candidates = [];
  const push = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) candidates.push(n);
  };
  push(acc?.adtrust_dsl);
  push(acc?.min_daily_budget);
  // Some accounts expose adspaymentcycle.threshold_amount as the hidden cap
  const cycles = Array.isArray(acc?.adspaymentcycle?.data) ? acc.adspaymentcycle.data : [];
  for (const c of cycles) {
    push(c?.threshold_amount);
    push(c?.amount_due);
  }
  if (candidates.length === 0) return 0;
  return Math.min(...candidates);
}

function normalizeFromAccount(acc) {
  const dsl = Number(acc?.adtrust_dsl);
  return {
    account_id: String(acc.account_id || acc.id || "").replace(/^act_/, ""),
    name: acc?.name,
    daily_spend_limit: Number.isFinite(dsl) && dsl > 0 ? dsl : 0,
    hidden_daily_limit: deriveHiddenLimit(acc),
    currency: acc?.currency || "USD",
    cards: extractAccountCards(acc),
  };
}

// ---------- HTTP helpers ----------
async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Rich field set including hidden-limit signals + cards
const ACCOUNT_FIELDS =
  "account_id,name,currency,adtrust_dsl,min_daily_budget,balance,amount_spent,spend_cap," +
  "funding_source_details," +
  "adspaymentcycle{funding_source_details,threshold_amount,amount_due}";

async function fetchOneAccount(accountId, accessToken) {
  const actId = String(accountId).replace(/^act_/, "");
  const url = `https://graph.facebook.com/v19.0/act_${actId}?fields=${ACCOUNT_FIELDS}&access_token=${encodeURIComponent(accessToken)}`;
  try {
    const res = await fetchWithTimeout(url, 15000);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) return null;
    body.account_id = actId;
    return normalizeFromAccount(body);
  } catch {
    return null;
  }
}

// Fetch all CRM-managed accounts in parallel batches
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

// ---------- Backend calls ----------
async function listManagedAccounts(apiUrl, anonKey, jwt) {
  const url = `${apiUrl.replace(/\/$/, "")}/functions/v1/list-managed-accounts`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: anonKey },
    body: "{}",
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.error || "list-managed-accounts failed");
    err.status = res.status;
    throw err;
  }
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
  if (!res.ok) {
    const err = new Error(body.error || "Ingest failed");
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---------- Main sync ----------
async function runAutoSync(reason = "alarm") {
  const stored = await getStored([
    "apiUrl", "anonKey", "jwt", "refreshToken", "userEmail", "autoSyncEnabled",
  ]);
  if (stored.autoSyncEnabled === false) return { skipped: true, reason: "disabled" };
  if (!stored.apiUrl || !stored.anonKey || !stored.jwt) return { skipped: true, reason: "not-logged-in" };

  await setStored({ lastSyncStatus: "running", lastSyncAt: Date.now(), lastSyncReason: reason });

  let jwt = stored.jwt;
  try {
    // 1) Get CRM-managed account ids
    let accountIds;
    try {
      accountIds = await listManagedAccounts(stored.apiUrl, stored.anonKey, jwt);
    } catch (err) {
      if (err.status === 401 && stored.refreshToken) {
        const refreshed = await refreshSupabaseToken(stored.apiUrl, stored.anonKey, stored.refreshToken);
        await setStored({ jwt: refreshed.access_token, refreshToken: refreshed.refresh_token });
        jwt = refreshed.access_token;
        accountIds = await listManagedAccounts(stored.apiUrl, stored.anonKey, jwt);
      } else throw err;
    }
    if (!accountIds.length) throw new Error("No CRM-managed Meta accounts");

    // 2) FB tab + token
    let tab = await findAdsManagerTab();
    let openedTab = false;
    if (!tab) { tab = await openAdsManagerTab(); openedTab = true; }

    let token = null;
    let lastInfo = null;
    for (let i = 0; i < 3 && !token; i++) {
      const info = await extractFbAccessToken(tab.id).catch(() => null);
      lastInfo = info;
      token = info?.token || null;
      if (!token && i < 2) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!token) throw new Error(`No Facebook token (scanned ${lastInfo?.candidates ?? 0})`);

    // 3) Fetch only managed accounts
    const accounts = await fetchManagedAccountsData(accountIds, token);
    if (!accounts.length) throw new Error("Could not fetch any managed accounts");

    // 4) Ingest
    let result;
    try {
      result = await ingestDsl(stored.apiUrl, stored.anonKey, jwt, accounts);
    } catch (err) {
      if (err.status === 401 && stored.refreshToken) {
        const refreshed = await refreshSupabaseToken(stored.apiUrl, stored.anonKey, stored.refreshToken);
        await setStored({ jwt: refreshed.access_token, refreshToken: refreshed.refresh_token });
        jwt = refreshed.access_token;
        result = await ingestDsl(stored.apiUrl, stored.anonKey, jwt, accounts);
      } else throw err;
    }

    if (openedTab) { try { await chrome.tabs.remove(tab.id); } catch {} }

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

// ---------- Card removal (called from content script) ----------
async function removeCardFromAccount({ accountId, fundingSourceId }) {
  // Find a tab with FB access to extract a token
  let tab = await findAdsManagerTab();
  if (!tab) tab = await openAdsManagerTab();

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

// ---------- Alarms ----------
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
});
