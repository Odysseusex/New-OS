// Service worker of the customer app (ar-amir.com/app): shows the notifications
// the bakery sends and opens the app when one is tapped. Nothing is cached.
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
    self.registration.showNotification(data.title || "Ar Amir", {
      body: data.body || "",
      tag: data.tag,
      icon: "/site/app/icon-192.png",
      badge: "/site/app/icon-192.png",
      data: { url: data.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).pathname.startsWith("/app") && "focus" in client) {
          client.postMessage({ type: "aa-open", url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
