/* Service Worker — notifications push (PWA) Gervi Télévente.
 *
 * Minimal et sans cache offline : on veut UNIQUEMENT le canal push +
 * l'ouverture au clic. (Un cache offline serait un autre chantier, risqué pour
 * une app SAP temps réel.)
 */

self.addEventListener("install", (event) => {
  // Active immédiatement le nouveau SW sans attendre la fermeture des onglets.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handler `fetch` minimal (pass-through réseau, AUCUN cache offline) : requis
// par les navigateurs pour rendre l'app « installable » (bouton Installer).
// On ne modifie pas les réponses — l'app reste une app en ligne temps réel.
self.addEventListener("fetch", () => {
  // No-op : on laisse le navigateur gérer la requête normalement.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Gervi", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Gervi · Télévente";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.renotify,
    data: { url: data.url || "/console" },
    // Vibration douce sur mobile.
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/console";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focalise un onglet déjà ouvert sur l'app si possible.
      for (const client of clientList) {
        try {
          const u = new URL(client.url);
          if (u.origin === self.location.origin && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        } catch (e) { /* ignore */ }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
