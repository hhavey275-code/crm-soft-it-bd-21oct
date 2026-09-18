// ============================================================
//  CRM Top-Up Helper — Auto-pilot service worker (v1.3.2)
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
const BASE = "https://crm-korbo-plan.lovable.app";
const API = BASE + "/api/public/crm-topup";
const WA_API = BASE + "/api/public/wa-jobs";

let ws = null;
let wsRef = 0;
let heartbeatTimer = null;
let running = false;
let waRunning = false;
const tabWaiters = new Map(); // requestId -> {resolve, tabId}
const waWaiters = new Map(); // tabId -> {resolve}

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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ token: autopilot.token }, body)),
  });
  return res.json();
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
  } catch {
    // network hiccup — next ping/alarm retries
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

// MV3 workers are suspended when idle; this alarm only wakes the worker so
// the socket can reconnect — it does not hit any server by itself.
chrome.alarms.create("crm-autopilot-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "crm-autopilot-keepalive") return;
  const { autopilot } = await getState();
  if (!autopilot || !autopilot.token) return;
  connectSocket();
  // Safety net: if the worker was asleep when a ping fired, catch up here.
  processQueue();
  processWaQueue();
});

chrome.runtime.onStartup.addListener(async () => {
  const { autopilot } = await getState();
  if (autopilot && autopilot.token) {
    connectSocket();
    processQueue();
    processWaQueue();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.set({ installedAt: Date.now() });
  const { autopilot } = await getState();
  if (autopilot && autopilot.token) connectSocket();
});

// Popup can ask us to (re)start or stop.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "crm-autopilot-control") return;
  (async () => {
    if (msg.command === "start") {
      connectSocket();
      processQueue();
      processWaQueue();
      sendResponse({ ok: true });
    } else if (msg.command === "wa-now") {
      // Diagnostic: report what the server says, then run the queue.
      try {
        const list = await waApi({ action: "list_pending" });
        if (!list || !list.ok) {
          sendResponse({ ok: false, error: (list && list.error) || "সার্ভার সাড়া দেয়নি" });
          return;
        }
        const n = (list.items || []).length;
        processWaQueue();
        sendResponse({ ok: true, pending: n });
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
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

// ============================================================
//  WhatsApp notifications — send queued messages via WhatsApp Web
// ============================================================
async function waApi(body) {
  const { autopilot } = await getState();
  if (!autopilot || !autopilot.token) throw new Error("Auto-pilot token not set");
  const res = await fetch(WA_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ token: autopilot.token }, body)),
  });
  return res.json();
}

function setWaLast(patch) {
  chrome.storage.local.get(["waLast"], (r) => {
    chrome.storage.local.set({ waLast: Object.assign({}, r.waLast || {}, patch) });
  });
}

async function processWaQueue() {
  if (waRunning) return;
  waRunning = true;
  try {
    const list = await waApi({ action: "list_pending" });
    if (!list || !list.ok) return;
    for (const item of list.items || []) {
      let claim;
      try {
        claim = await waApi({ action: "claim", id: item.id });
      } catch {
        return;
      }
      if (!claim || !claim.ok) {
        setWaLast({ at: Date.now(), ok: false, phone: item.phone, error: (claim && claim.error) || "claim failed" });
        // busy (gap not over) / daily limit reached / another PC took it
        if (claim && (claim.reason === "busy" || claim.reason === "limit")) return;
        continue;
      }
      let ok = false;
      let err = null;
      try {
        await sendWhatsApp(claim.phone, claim.body);
        ok = true;
      } catch (e) {
        err = e && e.message ? e.message : String(e);
      }
      try {
        await waApi({ action: "result", id: claim.id, success: ok, error: err });
      } catch {}
      setWaLast({ at: Date.now(), ok, phone: claim.phone, error: err });
      if (!ok) notify("WhatsApp বার্তা ব্যর্থ", `${claim.phone}: ${err}`);
      // Server also enforces the gap; pause here so the next claim succeeds.
      await sleep(45000);
    }
  } catch {
    // network hiccup — next wake-up retries
  } finally {
    waRunning = false;
  }
}

async function sendWhatsApp(phone, text) {
  const url =
    "https://web.whatsapp.com/send?phone=" +
    encodeURIComponent(phone) +
    "&text=" +
    encodeURIComponent(text) +
    "&type=phone_number&app_absent=0";
  const tab = await chrome.tabs.create({ url, active: false });
  const result = await new Promise((resolve) => {
    waWaiters.set(tab.id, { resolve });
    setTimeout(() => {
      if (waWaiters.has(tab.id)) {
        waWaiters.delete(tab.id);
        resolve({ success: false, error: "সময় শেষ — WhatsApp Web সাড়া দেয়নি" });
      }
    }, 120000);
  });
  try {
    await chrome.tabs.remove(tab.id);
  } catch {}
  if (!result.success) throw new Error(result.error || "send failed");
}

// The WhatsApp content script reports the outcome of its tab.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "wa-send-done") return;
  const tabId = sender && sender.tab ? sender.tab.id : null;
  const waiter = tabId != null ? waWaiters.get(tabId) : null;
  if (waiter) {
    waWaiters.delete(tabId);
    waiter.resolve({ success: !!msg.success, error: msg.error || null });
  }
});
