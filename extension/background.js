// ============================================================
//  DSL Sync — Background Service Worker
//  Runs an hourly auto-sync using stored credentials so the
//  dashboard always shows fresh Daily Spending Limit values
//  without the user having to open the popup.
//
//  Trigger: chrome.alarms ("auto-sync") every 60 minutes.
//  Requirements: user must have completed login in the popup
//  (jwt + apiUrl + anonKey present in chrome.storage.local) AND
//  Chrome must be running. If Chrome is closed, the alarm fires
//  on next browser startup.
// ============================================================

const ALARM_NAME = "auto-sync";
const SYNC_INTERVAL_MINUTES = 60; // hourly

// ---------- storage helpers ----------
function getStored(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res));
}
function setStored(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res));
}
function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
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

// ---------- Facebook tab + token extraction ----------
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
      const patterns = [
        /EAAG\w{50,}/g,
        /EAAB\w{50,}/g,
        /EAA[A-Za-z0-9]{80,}/g,
      ];
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

// ---------- Graph API ----------
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
  return mergeCards([], cards);
}

function normalizeDslAccount(acc) {
  const raw = acc.adtrust_dsl;
  const num = raw === null || raw === undefined || raw === "" ? 0 : Number(raw);
  return {
    account_id: acc.account_id || acc.id?.replace(/^act_/, ""),
    name: acc.name,
    daily_spend_limit: Number.isFinite(num) && num > 0 ? num : 0,
    currency: acc.currency || "USD",
    cards: extractAccountCards(acc),
  };
}

async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGraphCollection(url, { allowError = false, maxPages = 20, timeoutMs = 20000 } = {}) {
  const all = [];
  let pages = 0;
  while (url && pages < maxPages) {
    let body;
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      body = await res.json();
    } catch (err) {
      if (allowError) return all;
      throw new Error(`Facebook request failed/timed out: ${err?.message || err}`);
    }
    if (body.error) {
      if (allowError) return all;
      throw new Error(`Facebook: ${body.error.message}`);
    }
    if (Array.isArray(body.data)) all.push(...body.data);
    url = body.paging?.next || null;
    pages++;
  }
  return all;
}

async function fetchCardsForAccount(accountId, accessToken) {
  const actId = String(accountId || "").replace(/^act_/, "");
  if (!actId) return [];
  const token = encodeURIComponent(accessToken);
  const fields = "funding_source_details,adspaymentcycle{funding_source_details}";
  const url = `https://graph.facebook.com/v19.0/act_${actId}?fields=${fields}&access_token=${token}`;
  try {
    const res = await fetchWithTimeout(url, 12000);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) return [];
    return extractAccountCards(body);
  } catch {
    return [];
  }
}

async function fetchAllAdAccountsDsl(accessToken) {
  const fields = "account_id,name,adtrust_dsl,currency";
  const encodedToken = encodeURIComponent(accessToken);
  const byId = new Map();
  const addAccounts = (accounts) => {
    for (const acc of accounts) {
      const row = normalizeDslAccount(acc);
      if (!row.account_id) continue;
      const existing = byId.get(row.account_id);
      if (!existing) {
        byId.set(row.account_id, row);
      } else {
        byId.set(row.account_id, {
          ...existing,
          ...row,
          daily_spend_limit: Math.max(existing.daily_spend_limit || 0, row.daily_spend_limit || 0),
          cards: mergeCards(existing.cards, row.cards),
        });
      }
    }
  };

  addAccounts(await fetchGraphCollection(
    `https://graph.facebook.com/v19.0/me/adaccounts?fields=${fields}&limit=200&access_token=${encodedToken}`,
  ));

  const businesses = await fetchGraphCollection(
    `https://graph.facebook.com/v19.0/me/businesses?fields=id,name&limit=100&access_token=${encodedToken}`,
    { allowError: true, maxPages: 10 },
  );
  for (const biz of businesses) {
    if (!biz.id) continue;
    for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
      addAccounts(await fetchGraphCollection(
        `https://graph.facebook.com/v19.0/${biz.id}/${edge}?fields=${fields}&limit=200&access_token=${encodedToken}`,
        { allowError: true },
      ));
    }
  }

  const accounts = Array.from(byId.values());
  for (const batch of chunk(accounts, 8)) {
    await Promise.all(batch.map(async (account) => {
      if (account.cards?.length > 1) return;
      const cards = await fetchCardsForAccount(account.account_id, accessToken);
      account.cards = mergeCards(account.cards, cards);
    }));
  }
  return accounts;
}

// ---------- Backend ingest ----------
async function ingestDsl(apiUrl, anonKey, jwt, accounts) {
  const url = `${apiUrl.replace(/\/$/, "")}/functions/v1/ingest-dsl`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: anonKey,
    },
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

// ---------- Main sync routine ----------
async function runAutoSync(reason = "alarm") {
  const stored = await getStored(["apiUrl", "anonKey", "jwt", "refreshToken", "userEmail", "autoSyncEnabled"]);
  if (stored.autoSyncEnabled === false) {
    return { skipped: true, reason: "disabled" };
  }
  if (!stored.apiUrl || !stored.anonKey || !stored.jwt) {
    return { skipped: true, reason: "not-logged-in" };
  }

  await setStored({ lastSyncStatus: "running", lastSyncAt: Date.now(), lastSyncReason: reason });

  let jwt = stored.jwt;
  try {
    // 1) Find or open Facebook tab
    let tab = await findAdsManagerTab();
    let openedTab = false;
    if (!tab) {
      tab = await openAdsManagerTab();
      openedTab = true;
    }

    // 2) Extract FB access token (retry a few times)
    let token = null;
    let lastInfo = null;
    for (let i = 0; i < 3 && !token; i++) {
      const info = await extractFbAccessToken(tab.id).catch(() => null);
      lastInfo = info;
      token = info?.token || null;
      if (!token && i < 2) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!token) {
      throw new Error(`No Facebook token (scanned ${lastInfo?.candidates ?? 0})`);
    }

    // 3) Fetch all DSL
    const accounts = await fetchAllAdAccountsDsl(token);
    if (accounts.length === 0) throw new Error("No ad accounts returned");

    // 4) POST to backend (refresh JWT once on 401)
    let result;
    try {
      result = await ingestDsl(stored.apiUrl, stored.anonKey, jwt, accounts);
    } catch (err) {
      if (err.status === 401 && stored.refreshToken) {
        const refreshed = await refreshSupabaseToken(stored.apiUrl, stored.anonKey, stored.refreshToken);
        await setStored({ jwt: refreshed.access_token, refreshToken: refreshed.refresh_token });
        jwt = refreshed.access_token;
        result = await ingestDsl(stored.apiUrl, stored.anonKey, jwt, accounts);
      } else {
        throw err;
      }
    }

    // 5) Close the auto-opened tab to keep things tidy
    if (openedTab) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }

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
    await setStored({
      lastSyncStatus: "error",
      lastSyncAt: Date.now(),
      lastSyncError: message,
    });
    console.warn("[DSL auto-sync] failed:", message);
    return { ok: false, error: message };
  }
}

// ---------- Alarm wiring ----------
async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,            // first run shortly after install/startup
      periodInMinutes: SYNC_INTERVAL_MINUTES,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runAutoSync("alarm");
  }
});

// Allow popup to trigger a manual run / status check
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "run-auto-sync") {
    runAutoSync(msg.reason || "manual").then(sendResponse);
    return true; // async
  }
  if (msg?.type === "ensure-alarm") {
    ensureAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
});