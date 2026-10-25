// Service worker: caches the app shell so NUUVI opens instantly as an installed app,
// and shows push notifications (new posts, @mentions, your turn) when the app is closed.
const CACHE = 'nuuvi-shell-v84';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/icon.svg',
  '/manifest.webmanifest',
  '/js/main.js',
  '/js/lib.js',
  '/js/theme.js',
  '/js/views/auth.js',
  '/js/views/home.js',
  '/js/views/channel.js',
  '/js/views/story-settings.js',
  '/js/views/characters.js',
  '/js/views/people.js',
  '/js/views/notifications.js',
  '/js/views/admin.js',
  '/js/views/threads.js',
  '/js/views/social.js',
  '/js/views/directory.js',
  '/js/views/events.js',
  '/js/views/phone.js',
  '/js/views/overview.js',
  '/js/views/npcs.js',
  '/js/views/map.js',
  '/js/views/nu.js',
  '/js/views/messages.js',
  '/js/views/archive.js',
  '/js/views/profiles.js',
  '/js/views/stories.js',
  '/js/views/world.js',
  '/js/lore-preset.js',
  '/js/weather.js',
  '/js/citymap.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  // Network first (so updates show up right away), falling back to the cache when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html'))),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    (async () => {
      // Skip the popup if the app is open and focused; the in-app badge covers it.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((w) => w.focused && w.visibilityState === 'visible')) return;
      await self.registration.showNotification(data.title || 'NUUVI', {
        body: data.body || '',
        tag: data.tag,
        renotify: !!data.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: data.url || '/#/notifications' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/#/notifications';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ url: url.replace(/^\//, '') });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
