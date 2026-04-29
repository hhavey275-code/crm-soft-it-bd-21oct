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

// ---------- Graph API: list ad accounts with DSL + payment cards ----------
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
  // Meta's `adtrust_dsl` for ad accounts is returned in the account currency's
  // major units (e.g. USD dollars), NOT cents. Do NOT divide by 100.
  // Empirically: an account whose Billing page shows "Daily spending limit $1,011.25"
  // returns adtrust_dsl = 1011.25 (or 1011) from the Graph API.
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

async function fetchGraphCollection(url, { allowError = false, maxPages = 20 } = {}) {
  const all = [];
  let pages = 0;
  while (url && pages < maxPages) {
    const res = await fetch(url);
    const body = await res.json();
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
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) return [];
  return extractAccountCards(body);
}

async function fetchAllAdAccountsDsl(accessToken) {
  const fields = "account_id,name,adtrust_dsl,currency,funding_source_details,adspaymentcycle{funding_source_details}";
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

  // 1) User-level ad accounts. Fast, but Facebook can omit some BM accounts here.
  addAccounts(await fetchGraphCollection(
    `https://graph.facebook.com/v19.0/me/adaccounts?fields=${fields}&limit=200&access_token=${encodedToken}`,
  ));

  // 2) Business Manager owned/client ad accounts. This catches accounts that
  // are visible in Ads Manager/Billing but missing from /me/adaccounts.
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

// ---------- Send to backend ----------
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
    let tab = await findAdsManagerTab();
    if (!tab) {
      $("progress-text").textContent = "Opening Ads Manager (background)...";
      $("progress-bar").style.width = "15%";
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
        // Force-focus + reload the tab once on attempt 2 to make Facebook
        // re-emit its inline scripts with a fresh token.
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
        `Could not find Facebook access token (scanned ${lastInfo?.candidates ?? 0} candidates on ${lastInfo?.url || "the tab"}). ` +
        `Try this: open https://business.facebook.com/adsmanager/manage/accounts in a NEW tab, wait until it fully loads (the accounts table is visible), then click Sync again.`,
      );
    }

    $("progress-text").textContent = "Fetching all ad accounts from Facebook...";
    $("progress-bar").style.width = "60%";
    const accounts = await fetchAllAdAccountsDsl(token);
    if (accounts.length === 0) {
      throw new Error("No ad accounts found for this Facebook user.");
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
  autoSyncToggleEl.addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await setStored({ autoSyncEnabled: enabled });
    await refreshAutoSyncUi();
    if (enabled) {
      try { chrome.runtime.sendMessage({ type: "ensure-alarm" }); } catch {}
    }
  });
}

// Refresh status periodically while popup is open
setInterval(() => { refreshAutoSyncUi().catch(() => {}); }, 5000);

init();