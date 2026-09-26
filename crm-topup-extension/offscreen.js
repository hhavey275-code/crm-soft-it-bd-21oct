// Keeps the Auto-pilot service worker awake: Chrome suspends idle MV3
// workers, which made the helper miss new requests until the next alarm.
setInterval(() => {
  try { chrome.runtime.sendMessage({ type: "crm-keepalive" }); } catch {}
}, 20000);
