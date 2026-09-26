const API = "https://project--d985f3fc-b84f-4152-b2b7-4cffe71556ee.lovable.app/api/public/crm-topup";

const statusEl = document.getElementById("autopilotStatus");
const lastEl = document.getElementById("autopilotLast");
const onBox = document.getElementById("autopilotOn");
const offBox = document.getElementById("autopilotOff");
const tokenInput = document.getElementById("tokenInput");
const msgEl = document.getElementById("msg");

function cleanToken(value) {
  const normalized = String(value || "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
  const match = normalized.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return match ? match[0] : normalized;
}

function render(state) {
  const ap = state.autopilot;
  if (ap && ap.token) {
    statusEl.textContent = "চালু আছে";
    statusEl.className = "on";
    onBox.style.display = "block";
    offBox.style.display = "none";
  } else {
    statusEl.textContent = "বন্ধ আছে";
    statusEl.className = "off";
    onBox.style.display = "none";
    offBox.style.display = "block";
  }
  const last = state.autopilotLast;
  if (last && last.at) {
    const when = new Date(last.at).toLocaleString();
    lastEl.textContent =
      (last.ok ? "সর্বশেষ: ✓ " : "সর্বশেষ: ✕ ") + `$${last.amount} → ${last.accountId} (${when})` + (last.error ? " — " + last.error : "");
  } else {
    lastEl.textContent = "";
  }
}

function load() {
  chrome.storage.local.get(["autopilot", "autopilotLast"], render);
}

document.getElementById("enableBtn").addEventListener("click", async () => {
  msgEl.textContent = "";
  const token = cleanToken(tokenInput.value);
  if (!token) {
    msgEl.textContent = "Token বসানো হয়নি।";
    return;
  }
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "list_pending", token }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      msgEl.textContent = /^\s*</.test(text)
        ? "সার্ভার API-এর বদলে ওয়েবপেজ দিয়েছে — অ্যাপ Publish করে নতুন Helper নিন।"
        : `সার্ভার সঠিক উত্তর দেয়নি (HTTP ${res.status})`;
      return;
    }
    if (!res.ok || !data.ok) {
      msgEl.textContent = "Token কাজ করছে না: " + ((data && data.error) || "সার্ভার error");
      return;
    }
    chrome.storage.local.set({ autopilot: { token, enabledAt: Date.now() } }, () => {
      chrome.runtime.sendMessage({ type: "crm-autopilot-control", command: "start" }, () => load());
    });
  } catch (e) {
    msgEl.textContent = "সার্ভারে সংযোগ হয়নি — ইন্টারনেট চেক করুন।";
  }
});

document.getElementById("disableBtn").addEventListener("click", () => {
  chrome.storage.local.remove(["autopilot"], () => {
    chrome.runtime.sendMessage({ type: "crm-autopilot-control", command: "stop" }, () => load());
  });
});

load();
