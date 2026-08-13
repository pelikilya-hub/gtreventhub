// Сервис-воркер GTR Event: приём push-уведомлений.
// Пуш приходит без полезной нагрузки — карточку забираем из /api/push
// (кука сессии уходит вместе с запросом, содержимое не гуляет через шлюзы).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let card = null;
      try {
        const r = await fetch("/api/push", { credentials: "same-origin" });
        if (r.ok) card = await r.json();
      } catch {}
      return self.registration.showNotification(card?.title || "GTR EVENT", {
        body: card?.body || "Новое уведомление",
        icon: "/icon-256.png",
        badge: "/icon-256.png",
        tag: "gtr-event",
        data: { url: card?.url || "/gtr/dash" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/gtr/dash";
  e.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = list.find((c) => "focus" in c);
      if (open) {
        open.focus();
        if ("navigate" in open) open.navigate(url).catch(() => {});
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
