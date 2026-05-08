/* Push notification service worker — DO NOT confuse with PWA SW. */
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Notification", message: event.data ? event.data.text() : "" }; }
  const title = data.title || "Notification";
  const body = data.message || data.body || "";
  const options = {
    body,
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: data.tag || data.type || "default",
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || "/", ...data },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      try { await c.focus(); c.navigate(url); return; } catch {}
    }
    await self.clients.openWindow(url);
  })());
});
