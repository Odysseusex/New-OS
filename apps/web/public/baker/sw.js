// Service worker of the bakers' screen (/baker): shows «Рейс» notifications and opens the screen when one
// is tapped. Nothing is cached.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Накладные", {
      body: data.body || "",
      tag: data.tag,
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 150, 300],
      icon: "/baker/icon-192.png",
      badge: "/baker/icon-192.png",
      data: { url: data.url || "/baker" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/baker";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).pathname.startsWith("/baker") && "focus" in client) {
          client.postMessage({ type: "baker-refresh" });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
