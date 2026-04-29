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
      // Facebook's Ads Manager embeds an access token in inline scripts. The
      // most reliable pattern: it's a string starting with "EAA" inside a
      // JSON-like blob. We scan all script tags.
      const scripts = Array.from(document.querySelectorAll("script"));
      const tokens = new Set();
      for (const s of scripts) {
        const t = s.textContent || "";
        // Match "accessToken":"EAA...","
        const re1 = /"accessToken":"(EAA[^"]+)"/g;
        let m;
        while ((m = re1.exec(t))) tokens.add(m[1]);
        // Match "access_token":"EAA..."
        const re2 = /"access_token":"(EAA[^"]+)"/g;
        while ((m = re2.exec(t))) tokens.add(m[1]);
      }
      // Prefer the longest token (typically the user-bound one with full perms)
      return Array.from(tokens).sort((a, b) => b.length - a.length)[0] || null;
    },
  });
  return result;
}

// ---------- Graph API: list ad accounts with DSL ----------
async function fetchAllAdAccountsDsl(accessToken) {
  const fields = "account_id,name,adtrust_dsl,currency";
  let url = `https://graph.facebook.com/v19.0/me/adaccounts?fields=${fields}&limit=200&access_token=${encodeURIComponent(accessToken)}`;
  const all = [];
  let pages = 0;
  while (url && pages < 20) {
    const res = await fetch(url);
    const body = await res.json();
    if (body.error) throw new Error(`Facebook: ${body.error.message}`);
    if (Array.isArray(body.data)) all.push(...body.data);
    url = body.paging?.next || null;
    pages++;
  }
  // Normalize: adtrust_dsl is in account currency MINOR units (cents).
  return all.map((acc) => ({
    account_id: acc.account_id || acc.id?.replace(/^act_/, ""),
    name: acc.name,
    daily_spend_limit: acc.adtrust_dsl ? Number(acc.adtrust_dsl) / 100 : 0,
    currency: acc.currency || "USD",
  }));
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
    for (let i = 0; i < 3 && !token; i++) {
      token = await extractFbAccessToken(tab.id);
      if (!token) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!token) {
      throw new Error("Could not find Facebook access token. Make sure you're logged into Facebook with admin access, then try again.");
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

init();