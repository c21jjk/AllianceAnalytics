/*
 * Alliance Social service worker.
 *
 * Three jobs:
 *   1. App-shell caching — brand assets + fonts are served
 *      stale-while-revalidate so the installed PWA paints instantly on
 *      cell connections. Navigations stay network-first (this is a live
 *      analytics tool — stale data is worse than a spinner) with an
 *      offline fallback page.
 *   2. Web Push — receives pushes from the server (publish results,
 *      performance alerts) and shows them as native notifications.
 *      On iOS this only works when the app is installed to the home
 *      screen (iOS 16.4+).
 *   3. Notification click-through — focuses the open PWA (or opens a
 *      new window) at the URL carried in the push payload.
 *
 * Bump CACHE_VERSION whenever cached-asset semantics change; activate()
 * deletes older caches.
 */

const CACHE_VERSION = "alliance-shell-v1";
const OFFLINE_URL = "/offline.html";

// Precached on install — the minimal set needed to render the offline page
// and the app icons used by notifications.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/brand/app-icons/icon-192.png",
  "/brand/app-icons/apple-touch-icon.png",
  "/brand/analytics-wordmark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// why: static brand/font assets are immutable-ish — serve from cache and
// refresh in the background. Everything else (pages, API, Supabase-hosted
// images) goes straight to the network; navigations get the offline page
// as a last resort so the installed app never shows the Safari dinosaur.
function isShellAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/brand/") || url.pathname.startsWith("/fonts/"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(request).then((cached) => {
          const refresh = fetch(request)
            .then((response) => {
              if (response && response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || refresh;
        }),
      ),
    );
  }
});

// ---- Web Push ----

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Alliance Social", body: event.data && event.data.text() };
  }

  const title = payload.title || "Alliance Social";
  const options = {
    body: payload.body || "",
    icon: "/brand/app-icons/icon-192.png",
    badge: "/brand/app-icons/icon-192.png",
    // tag dedupes repeated notifications for the same post (e.g. FB then
    // IG succeeding seconds apart re-uses one banner instead of stacking).
    tag: payload.tag || undefined,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          // Reuse an existing window when the PWA is already open.
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client && client.url !== targetUrl) {
              return client.navigate(targetUrl).catch(() => undefined);
            }
            return undefined;
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
