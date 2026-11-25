/* Kronner Service Worker — Web Push & Standalone PWA */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function sanitizeRelativeUrl(raw) {
  if (typeof raw !== 'string') return '/painel?tab=notices';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/painel?tab=notices';
  }
  return trimmed;
}

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
  const url = sanitizeRelativeUrl(data.url);
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
  const targetPath = sanitizeRelativeUrl(
    event.notification && event.notification.data ? event.notification.data.url : '/painel?tab=notices'
  );

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const origin = self.location.origin;
      let targetUrl = new URL('/painel?tab=notices', origin).href;
      try {
        const resolved = new URL(targetPath, origin);
        if (resolved.origin === origin) {
          targetUrl = resolved.href;
        }
      } catch {
        // Fallback stays same-origin
      }

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
