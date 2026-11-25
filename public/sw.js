/* Kronner Service Worker — Web Push & Standalone PWA */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Kronner', body: event.data.text() };
  }

  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Kronner';
  const body = typeof data.body === 'string' ? data.body : '';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/painel?tab=notices';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : 'kronner-notice';

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath =
    (event.notification && event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/painel?tab=notices');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const origin = self.location.origin;
      const targetUrl = new URL(targetPath, origin).href;

      for (const client of clientList) {
        if (client.url.startsWith(origin) && 'focus' in client) {
          if ('navigate' in client) {
            return client.navigate(targetUrl).then(() => client.focus()).catch(() => client.focus());
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
