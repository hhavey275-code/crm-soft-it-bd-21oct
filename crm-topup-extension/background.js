// ============================================================
//  CRM Top-Up Helper — Auto-pilot service worker (v2.00)
//  Event-driven: listens to Supabase Realtime for a ping that a
//  new pending external top-up request arrived, then claims and
//  runs it through the existing content-script automation.
//  No polling loop — a chrome.alarm only re-wakes the worker so
//  the WebSocket can reconnect if Chrome suspended it.
// ============================================================

const SUPABASE_WS =
  "wss://dhswrfzdqcavgmymllat.supabase.co/realtime/v1/websocket?apikey=" +
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s" +
  "&vsn=1.0.0";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s";
const BASE = "https://project--d985f3fc-b84f-4152-b2b7-4cffe71556ee.lovable.app";
const API = BASE + "/api/public/crm-topup";

let ws = null;
let wsRef = 0;
let heartbeatTimer = null;
let running = false;
const tabWaiters = new Map(); // requestId -> {resolve, tabId}

// ---------- storage ----------
function getState() {
  return new Promise((resolve) =>
    chrome.storage.local.get(["autopilot", "autopilotLast"], (r) =>
      resolve({ autopilot: r.autopilot || null, last: r.autopilotLast || null })
    )
  );
}
function setLast(patch) {
  chrome.storage.local.get(["autopilotLast"], (r) => {
    chrome.storage.local.set({ autopilotLast: Object.assign({}, r.autopilotLast || {}, patch) });
  });
}

// ---------- API ----------
async function api(body) {
  const { autopilot } = await getState();
  if (!autopilot || !autopilot.token) throw new Error("Auto-pilot token not set");
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(Object.assign({ token: autopilot.token }, body)),
  });
  return readJsonResponse(res, "CRM");
}

async function readJsonResponse(res, service) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const looksLikePage = /^\s*</.test(text);
    throw new Error(
      looksLikePage
        ? `${service} সার্ভার API-এর বদলে ওয়েবপেজ দিয়েছে — অ্যাপ Publish করে Helper আপডেট করুন`
        : `${service} সার্ভার সঠিক উত্তর দেয়নি (HTTP ${res.status})`
    );
  }
  if (!res.ok && (!data || typeof data !== "object")) {
    throw new Error(`${service} সার্ভার error (HTTP ${res.status})`);
  }
  return data;
}

// ---------- notifications ----------
function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title,
      message,
      priority: 2,
    });
  } catch {}
}

// ---------- queue ----------
const GAP_MS = 30000; // spacing between two CRM top-ups

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processQueue() {
  if (running) return;
  running = true;
  try {
    const list = await api({ action: "list_pending" });
    if (!list || !list.ok) {
      if (list && (list.reason === "expired" || /expired/i.test(list.error || ""))) {
        notify("Auto-pilot থেমে গেছে", "Token-এর মেয়াদ শেষ — ড্যাশবোর্ড থেকে নতুন token নিয়ে আবার চালু করুন।");
      }
      return;
    }
    let first = true;
    for (const item of list.items || []) {
      if (!item.url || !item.accountId) continue;
      if (!first) await sleep(GAP_MS);
      first = false;
      try {
        const done = await runOne(item);
        if (done === "busy") return; // another PC is running one — wait for next wake-up
      } catch (e) {
        notify("Auto-pilot ব্যর্থ", `${item.accountId} — $${item.amount}: ${e && e.message ? e.message : e}`);
        setLast({ at: Date.now(), ok: false, accountId: item.accountId, amount: item.amount, error: String(e && e.message ? e.message : e) });
      }
    }
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    setLast({ at: Date.now(), ok: false, error: message });
    notify("Auto-pilot সংযোগ নেই", message);
  } finally {
    running = false;
  }
}

async function runOne(item) {
  const claim = await api({ action: "claim", requestId: item.id });
  if (!claim || !claim.ok) {
    if (claim && claim.reason === "busy") return "busy";
    if (claim && claim.error && /claimed|pending|running/i.test(claim.error)) return "skip"; // another instance took it
    throw new Error((claim && claim.error) || "claim failed");
  }

  // A retry may be claimed from an old completed row. Mark the browser
  // session explicitly so the result endpoint clears that retry queue.
  claim.retry = !!item.retry;

  const url = `${claim.url}${claim.url.includes("#") ? "" : "#"}crmtopup=${encodeURIComponent(claim.token)}&api=${encodeURIComponent(API)}`;
  const tab = await chrome.tabs.create({ url, active: false });

  const done = new Promise((resolve) => {
    tabWaiters.set(item.id, { resolve, tabId: tab.id });
    setTimeout(() => {
      if (tabWaiters.has(item.id)) {
        tabWaiters.delete(item.id);
        resolve({ success: false, error: "সময় শেষ (২ মিনিট) — CRM রেসপন্স করেনি" });
      }
    }, 120000);
  });

  const result = await done;
  try {
    await chrome.tabs.remove(tab.id);
  } catch {}
  if (!result.success) throw new Error(result.error || "automation failed");
  notify("Auto-pilot সফল", `$${item.amount} → ${item.accountId}`);
  setLast({ at: Date.now(), ok: true, accountId: item.accountId, amount: item.amount });
}

// Content script reports the outcome of an Auto-pilot job.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "crm-autopilot-done") return;
  const waiter = tabWaiters.get(msg.requestId);
  if (waiter) {
    tabWaiters.delete(msg.requestId);
    waiter.resolve({ success: !!msg.success, error: msg.error || null });
  }
});

// ---------- Supabase Realtime (raw Phoenix WebSocket) ----------
function wsSend(topic, event, payload, ref) {
  try {
    ws.send(JSON.stringify({ topic, event, payload: payload || {}, ref: String(ref != null ? ref : ++wsRef) }));
  } catch {}
}

function connectSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(SUPABASE_WS);
  } catch {
    return;
  }
  ws.onopen = () => {
    wsSend(
      "realtime:public:autopilot_pings",
      "phx_join",
      {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: "" },
          postgres_changes: [{ event: "INSERT", schema: "public", table: "autopilot_pings" }],
        },
        access_token: SUPABASE_ANON,
      },
      1
    );
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => wsSend("phoenix", "heartbeat", {}), 25000);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.event === "postgres_changes") {
        processQueue();
      }
    } catch {}
  };
  ws.onclose = () => {
    clearInterval(heartbeatTimer);
    ws = null;
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {}
  };
}

// ---------- 24/7 keep-alive ----------
async function ensureOffscreen() {
  try {
    if (!chrome.offscreen) return;
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Keep Auto-pilot connected so new top-up requests run instantly",
    });
  } catch {}
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "crm-keepalive") return;
  getState().then(({ autopilot }) => {
    if (autopilot && autopilot.token) {
      connectSocket();
      // Realtime can be interrupted by a locked screen or a network switch.
      // Check the queue on every keep-alive as a deterministic fallback.
      processQueue();
    }
  });
});
ensureOffscreen();
getState().then(({ autopilot }) => {
  if (autopilot && autopilot.token) {
    connectSocket();
    processQueue();
  }
});

// MV3 workers are suspended when idle; this alarm only wakes the worker so
// the socket can reconnect — it does not hit any server by itself.
chrome.alarms.create("crm-autopilot-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "crm-autopilot-keepalive") return;
  const { autopilot } = await getState();
  ensureOffscreen();
  if (!autopilot || !autopilot.token) return;
  connectSocket();
  // Safety net: if the worker was asleep when a ping fired, catch up here.
  processQueue();
});

chrome.runtime.onStartup.addListener(async () => {
  ensureOffscreen();
  const { autopilot } = await getState();
  if (autopilot && autopilot.token) {
    connectSocket();
    processQueue();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.set({ installedAt: Date.now() });
  const { autopilot } = await getState();
  if (autopilot && autopilot.token) {
    connectSocket();
    processQueue();
  }
});

// Popup can ask us to (re)start or stop.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "crm-autopilot-control") return;
  (async () => {
    if (msg.command === "start") {
      ensureOffscreen();
      connectSocket();
      processQueue();
      sendResponse({ ok: true });
    } else if (msg.command === "stop") {
      if (ws) {
        try {
          ws.close();
        } catch {}
        ws = null;
      }
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});
