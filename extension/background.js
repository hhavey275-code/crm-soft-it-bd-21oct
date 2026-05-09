// ============================================================
//  DSL Sync — Background Service Worker (v1.4.4)
//  - No mass sweeps / alarms (Meta detection-safe)
//  - Per-account on-demand sync via "sync-single-account"
//  - Opportunistic snapshots from content.js when user opens billing page
//  - Card removal only while user is on a Meta billing page
// ============================================================

// Per-account cooldown so spam clicks don't open duplicate tabs
const SYNC_COOLDOWN_MS = 8000;
const recentSyncs = new Map();

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

// Open billing page in a *minimized window* so Meta's SPA actually
// renders (Chrome throttles invisible background tabs and Meta won't
// fire its GraphQL calls — that's why background sync was failing).
// We close the window when done. Returns { tab, windowId }.
async function openBillingWindow(accountId) {
  const actId = String(accountId).replace(/^act_/, "");
  const url = `https://business.facebook.com/billing_hub/accounts/details?asset_id=${actId}`;
  return new Promise((resolve, reject) => {
    chrome.windows.create(
      {
        url,
        focused: false,
        state: "minimized",
        type: "normal",
        width: 1280,
        height: 900,
      },
      (win) => {
        if (!win || !win.tabs || !win.tabs[0]) {
          reject(new Error("Could not open background window"));
          return;
        }
        const tab = win.tabs[0];
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          chrome.tabs.onUpdated.removeListener(listener);
          // Generous wait so React/Relay can hydrate and fire GraphQL.
          setTimeout(() => resolve({ tab, windowId: win.id }), 6000);
        };
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") finish();
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Hard timeout fallback in case 'complete' never fires
        setTimeout(finish, 20000);
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

// ---------- Per-account on-demand sync ----------
async function syncSingleAccount(accountId) {
  const id = String(accountId || "").replace(/^act_/, "");
  if (!id) return { ok: false, error: "Missing accountId" };

  const last = recentSyncs.get(id) || 0;
  if (Date.now() - last < SYNC_COOLDOWN_MS) {
    return { ok: false, error: "Please wait a few seconds before syncing this account again." };
  }
  recentSyncs.set(id, Date.now());

  let windowId = null;
  let tab = null;
  try {
    const opened = await openBillingWindow(id);
    tab = opened.tab;
    windowId = opened.windowId;

    // Retry the snapshot collection — Meta sometimes needs an extra moment
    // for the page to populate after hydration.
    let res = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await sendTabMessage(tab.id, { type: "collect-billing-snapshot", timeoutMs: 25000 }, 6);
        if (res?.ok) break;
        lastErr = res?.error || "empty snapshot";
      } catch (e) {
        lastErr = e?.message || String(e);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!res?.ok) throw new Error(lastErr || "Could not parse billing page");

    await setStored({ lastSyncStatus: "success", lastSyncAt: Date.now(), lastSyncSaved: 1, lastSyncError: null });
    return { ok: true, accountId: id };
  } catch (err) {
    const message = err?.message || String(err);
    await setStored({ lastSyncStatus: "error", lastSyncAt: Date.now(), lastSyncError: message });
    return { ok: false, error: message };
  } finally {
    if (windowId) { try { await chrome.windows.remove(windowId); } catch {} }
    else if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
  }
}

// ---------- Pending sync requests from CRM (clients asking admin to sync) ----------
let pendingPollerRunning = false;
async function processPendingSyncRequests() {
  if (pendingPollerRunning) return { ok: false, error: "already-running" };
  pendingPollerRunning = true;
  try {
    const stored = await getStored(["apiUrl", "anonKey", "jwt", "refreshToken"]);
    if (!stored.apiUrl || !stored.anonKey || !stored.jwt) {
      return { ok: false, error: "not-logged-in" };
    }
    const list = await callBackend(
      stored.apiUrl, stored.anonKey, stored.jwt, stored.refreshToken,
      "list-pending-sync-requests", {},
    );
    const requests = list.requests || [];
    if (!requests.length) return { ok: true, processed: 0 };

    let done = 0; let failed = 0;
    for (const r of requests) {
      const sync = await syncSingleAccount(r.meta_account_id);
      try {
        await callBackend(
          stored.apiUrl, stored.anonKey, stored.jwt, stored.refreshToken,
          "complete-sync-request",
          {
            request_id: r.id,
            status: sync.ok ? "done" : "failed",
            error: sync.ok ? null : sync.error,
          },
        );
      } catch (e) { console.warn("complete-sync-request failed", e); }
      if (sync.ok) done++; else failed++;
      // Throttle so Meta doesn't see rapid window churn
      await new Promise((r) => setTimeout(r, 4000));
    }

    try {
      chrome.notifications?.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "DSL Sync — pending requests processed",
        message: `Synced ${done} account(s)${failed ? `, ${failed} failed` : ""}.`,
      });
    } catch {}

    return { ok: true, processed: requests.length, done, failed };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    pendingPollerRunning = false;
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
function decodeFsId(rawId) {
  const s = String(rawId || "").trim();
  if (!s) return s;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 8) {
    try {
      const decoded = atob(s);
      const m = decoded.match(/(\d{8,})\s*$/);
      if (m) return m[1];
    } catch {}
  }
  return s;
}
async function removeCardFromAccount({ accountId, fundingSourceId, card, tabId }) {
  fundingSourceId = decodeFsId(fundingSourceId);
  let tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) tab = await findFbTab();
  if (!tab) tab = await openFbTab();
  if (!fundingSourceId || String(fundingSourceId).startsWith("local:")) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (hint) => {
        const panel = document.getElementById("dsl-crm-panel");
        const isVisible = (el) => {
          if (!el || (panel && panel.contains(el))) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 8 && rect.height > 8;
        };
        const normalizeBrand = (brand) => {
          const b = String(brand || "").replace(/\s+/g, "").toLowerCase();
          if (b === "mastercard" || b === "master") return "mastercard";
          if (b === "amex" || b === "americanexpress") return "americanexpress";
          return b;
        };
        const brand = String(hint?.type || hint?.removal_hint?.brand || "").toLowerCase();
        const last4 = String(hint?.removal_hint?.last4 || hint?.display_string || "").match(/(\d{4})/)?.[1];
        const wantedBrand = normalizeBrand(brand);
        const nodes = Array.from(document.querySelectorAll('li, [role="listitem"], [role="row"], div')).filter(isVisible);
        const holder = nodes.find((el) => {
          const t = (el.textContent || "").toLowerCase();
          const normalizedText = normalizeBrand(t);
          return t.length < 260 && (!wantedBrand || normalizedText.includes(wantedBrand)) && (!last4 || t.includes(last4));
        });
        if (!holder) return { ok: false, error: "Card row not found on this billing page" };
        const clickByText = (root) => {
          const buttons = Array.from(root.querySelectorAll('button, [role="button"], a')).filter(isVisible);
          const btn = buttons.find((b) => /remove|delete|detach/i.test(`${b.textContent || ""} ${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`));
          if (btn) { btn.click(); return true; }
          return false;
        };
        if (clickByText(holder)) return { ok: true, pending_confirmation: true };
        const holderButtons = Array.from(holder.querySelectorAll('button, [role="button"]')).filter(isVisible);
        const menu = holderButtons.reverse().find((b) => /more|menu|options|⋯|…|ellipsis/i.test(`${b.textContent || ""} ${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`));
        if (!menu) return { ok: false, error: "Remove/menu button not found for this card" };
        menu.click();
        return new Promise((resolve) => {
          setTimeout(() => {
            const opened = clickByText(document);
            resolve(opened ? { ok: true, pending_confirmation: true } : { ok: false, error: "Remove option not available for this card" });
          }, 700);
        });
      },
      args: [card || {}],
    });
    return result || { ok: false, error: "Could not open Meta remove action" };
  }
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

// ---------- SMIT-style: GraphQL remove via captured creds ----------
// Tries multiple known Meta mutation names; the first one accepted wins.
async function removeCardViaGraphql({ accountId, cardId, card, creds, pageUrl }) {
  cardId = decodeFsId(cardId);
  if (!creds?.fb_dtsg) {
    return { ok: false, error: "fb_dtsg not captured yet — refresh the billing page once." };
  }
  if (!cardId || String(cardId).startsWith("local:")) {
    return { ok: false, error: "Card has no real Meta id (local hint only)." };
  }
  const actId = String(accountId).replace(/^act_/, "");
  const referer = pageUrl || `https://business.facebook.com/billing_hub/accounts/details?asset_id=${actId}`;

  // Build base form params (Meta accepts URL-encoded mutation calls)
  function form(extra) {
    const sp = new URLSearchParams();
    sp.set("av", creds.__user || creds.av || "0");
    sp.set("__user", creds.__user || "0");
    sp.set("__a", "1");
    sp.set("__req", "a");
    sp.set("dpr", "2");
    if (creds.__rev) sp.set("__rev", creds.__rev);
    if (creds.__hs) sp.set("__hs", creds.__hs);
    if (creds.__spin_r) sp.set("__spin_r", creds.__spin_r);
    if (creds.__spin_t) sp.set("__spin_t", creds.__spin_t);
    if (creds.__spin_b) sp.set("__spin_b", creds.__spin_b);
    sp.set("fb_dtsg", creds.fb_dtsg);
    sp.set("jazoest", creds.jazoest || "0");
    if (creds.lsd) sp.set("lsd", creds.lsd);
    sp.set("server_timestamps", "true");
    for (const [k, v] of Object.entries(extra || {})) sp.set(k, String(v));
    return sp;
  }

  // Variants: known mutation names Meta has used
  const attempts = [
    {
      name: "BillingPaymentMethodDeleteMutation",
      doc_id: null,
      vars: { input: { client_mutation_id: "1", payment_account_id: actId, payment_method_id: cardId, actor_id: creds.__user || "0" } },
    },
    {
      name: "useBillingRemovePaymentMethodMutation",
      doc_id: null,
      vars: { input: { client_mutation_id: "1", actor_id: creds.__user || "0", payment_account_id: actId, payment_method_id: cardId } },
    },
    {
      name: "BillingHubRemovePaymentMethodMutation",
      doc_id: null,
      vars: { input: { client_mutation_id: "1", payment_method_id: cardId, ad_account_id: actId, actor_id: creds.__user || "0" } },
    },
  ];

  let lastError = null;
  for (const a of attempts) {
    const body = form({
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: a.name,
      variables: JSON.stringify(a.vars),
      doc_id: a.doc_id || "",
    });
    try {
      const res = await fetch("https://www.facebook.com/api/graphql/", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-FB-Friendly-Name": a.name,
          "X-FB-LSD": creds.lsd || "",
          "Sec-Fetch-Site": "same-origin",
        },
        body: body.toString(),
        referrer: referer,
      });
      const text = await res.text();
      // Meta sometimes prefixes with "for (;;);"
      const cleaned = text.replace(/^for \(;;\);/, "").trim();
      let json = null;
      try { json = JSON.parse(cleaned); } catch {}
      if (res.ok && json && !json.errors && !json.error) {
        return { ok: true, mutation: a.name, response: json };
      }
      lastError = json?.errors?.[0]?.message || json?.error?.message || `${a.name} -> ${res.status}`;
    } catch (e) {
      lastError = `${a.name}: ${e?.message || e}`;
    }
  }
  return { ok: false, error: lastError || "All remove mutations failed" };
}

// Fallback: use Graph API DELETE with EAA token if we managed to capture one
async function removeCardViaGraphApi({ accountId, cardId, creds }) {
  cardId = decodeFsId(cardId);
  if (!creds?.access_token) return { ok: false, error: "no_access_token" };
  const actId = String(accountId).replace(/^act_/, "");
  const url = `https://graph.facebook.com/v19.0/act_${actId}/payment_methods/${encodeURIComponent(cardId)}?access_token=${encodeURIComponent(creds.access_token)}`;
  try {
    const res = await fetch(url, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) return { ok: false, error: body?.error?.message || `HTTP ${res.status}` };
    return { ok: true, via: "graph_api" };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function removeCardSmart(payload) {
  // 1) Try GraphQL replay with captured creds
  const g = await removeCardViaGraphql(payload);
  if (g.ok) return g;
  // 2) Fall back to Graph API DELETE
  const fb = await removeCardViaGraphApi(payload);
  if (fb.ok) return fb;
  // 3) Final fallback: open Meta UI and click Remove (legacy path)
  return await removeCardFromAccount({
    accountId: payload.accountId,
    fundingSourceId: payload.cardId,
    card: payload.card,
    tabId: payload.tabId,
  });
}

// ---------- Messaging ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "run-auto-sync") {
    runAutoSync(msg.reason || "manual").then(sendResponse);
    return true;
  }
  if (msg?.type === "sync-single-account") {
    syncSingleAccount(msg.accountId).then(sendResponse);
    return true;
  }
  if (msg?.type === "process-pending-sync-requests") {
    processPendingSyncRequests().then(sendResponse);
    return true;
  }
  if (msg?.type === "remove-card") {
    // Legacy path
    removeCardFromAccount({ ...(msg.payload || {}), tabId: sender?.tab?.id })
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "remove-card-graphql") {
    // SMIT-style path: use creds captured by the page hook
    removeCardSmart({ ...(msg.payload || {}), tabId: sender?.tab?.id })
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
