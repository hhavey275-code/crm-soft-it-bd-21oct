// CRM <-> DSL Sync extension bridge.
// The extension's content script is injected on *.lovable.app and *.lovable.dev,
// listens for window.postMessage({ source: "dsl-crm", ... }) events,
// forwards to the background service worker, and posts the result back
// as window.postMessage({ source: "dsl-extension", ... }).

export type SyncSingleAccountResult =
  | { ok: true; accountId: string }
  | { ok: false; error: string };

let reqCounter = 0;

export function syncSingleAccountViaExtension(accountId: string, timeoutMs = 35000): Promise<SyncSingleAccountResult> {
  return new Promise((resolve) => {
    const requestId = `sync-${Date.now()}-${++reqCounter}`;
    let done = false;

    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve({
        ok: false,
        error:
          "Extension did not respond. Make sure the v1.4.4 'DSL & Cards Sync' extension is installed and you are logged in.",
      });
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as any;
      if (!data || data.source !== "dsl-extension" || data.type !== "sync-single-account-result") return;
      if (data.requestId !== requestId) return;
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      const r = data.response;
      if (r && r.ok) resolve({ ok: true, accountId: r.accountId });
      else resolve({ ok: false, error: r?.error || "Sync failed" });
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "dsl-crm", type: "sync-single-account", requestId, accountId },
      "*",
    );
  });
}
