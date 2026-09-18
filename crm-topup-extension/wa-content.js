// ============================================================
//  WhatsApp Web sender — runs only on web.whatsapp.com tabs that
//  the Auto-pilot opened for a queued message. The tab is opened
//  with ?phone=...&text=... so the text is already in the box; we
//  just wait for the send button and click it.
// ============================================================
(function () {
  if (!/^https:\/\/web\.whatsapp\.com/.test(location.href)) return;
  if (!/[?&]phone=/.test(location.search)) return; // not one of our jobs

  const TIMEOUT_MS = 90000;
  const started = Date.now();
  let finished = false;

  function report(success, error) {
    if (finished) return;
    finished = true;
    try {
      chrome.runtime.sendMessage({ type: "wa-send-done", success, error: error || null });
    } catch {}
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findSend() {
    return (
      document.querySelector('button[data-tab="11"]') ||
      document.querySelector('[data-testid="send"]') ||
      document.querySelector('span[data-icon="send"]')?.closest("button") ||
      document.querySelector('[aria-label="Send"]')
    );
  }

  function notLoggedIn() {
    return (
      !!document.querySelector('[data-testid="qrcode"]') ||
      !!document.querySelector('canvas[aria-label*="Scan"]') ||
      /Log into WhatsApp|Steps to log in/i.test(document.body.innerText || "")
    );
  }

  function invalidNumber() {
    const t = document.body.innerText || "";
    return /Phone number shared via url is invalid|invalid format|isn't on WhatsApp|not on WhatsApp/i.test(t);
  }

  (async function run() {
    while (Date.now() - started < TIMEOUT_MS) {
      if (invalidNumber()) return report(false, "নম্বরটি WhatsApp-এ নেই বা ভুল");
      if (notLoggedIn()) return report(false, "WhatsApp Web-এ লগইন নেই");

      const btn = findSend();
      if (btn) {
        try {
          btn.click();
        } catch (e) {
          return report(false, "Send বাটনে ক্লিক করা যায়নি");
        }
        await sleep(4000);
        if (invalidNumber()) return report(false, "নম্বরটি WhatsApp-এ নেই বা ভুল");
        return report(true, null);
      }
      await sleep(1000);
    }
    report(false, "সময় শেষ — WhatsApp Web লোড হয়নি");
  })();
})();
