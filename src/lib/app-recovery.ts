// Client-side resilience layer.
// Fixes the "white screen / site unavailable" class of problems that happen
// when a user's browser holds a stale service worker or stale cached JS chunks
// after a new deploy. Runs once on the client, never throws.

const RELOAD_FLAG = "app_recovery_reloaded_at";
const RELOAD_COOLDOWN_MS = 60_000;

async function clearCaches() {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
}

async function unregisterStaleServiceWorkers() {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const url =
        reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
      // Only the push SW is legitimate. Anything else (old PWA/offline SW)
      // can serve a stale index.html that points at deleted asset hashes.
      if (!url.includes("/sw-push.js")) {
        await reg.unregister().catch(() => {});
        await clearCaches();
      }
    }
  } catch {
    /* ignore */
  }
}

function canReload() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export async function recoverFromStaleAssets() {
  await clearCaches();
  await unregisterStaleServiceWorkers();
  if (typeof window !== "undefined") window.location.reload();
}

function isChunkLoadError(message: string) {
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk .* failed/i.test(message) ||
    /Unexpected token '<'/i.test(message)
  );
}

export function installAppRecovery() {
  if (typeof window === "undefined") return;

  void unregisterStaleServiceWorkers();

  const handle = (raw: unknown) => {
    const message =
      raw instanceof Error ? `${raw.name}: ${raw.message}` : String((raw as any) ?? "");
    if (!isChunkLoadError(message)) return;
    if (!canReload()) return;
    void recoverFromStaleAssets();
  };

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    handle((event as any).payload ?? "Failed to fetch dynamically imported module");
  });
  window.addEventListener("error", (event) => handle(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => handle(event.reason));
}
