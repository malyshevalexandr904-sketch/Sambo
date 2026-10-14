// Service worker SAMBO Digital (Phase 8b): показ push-уведомлений и переход по нажатию. Офлайн-кэша нет —
// запросы страниц он не перехватывает. Сообщение (contracts: PushMessage) — заголовок и текст без имён детей,
// путь в приложении с локалью и метка (новое уведомление о той же схватке заменяет прежнее).
'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Только путь своего сайта: ссылка из сообщения не уводит на чужой адрес. */
function safePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\'))
    return '/';
  return url;
}

function parse(event) {
  try {
    const m = event.data ? event.data.json() : null;
    if (m && m.v === 1 && typeof m.title === 'string' && typeof m.body === 'string') return m;
  } catch (e) {
    // Не JSON — общее уведомление ниже.
  }
  return null;
}

self.addEventListener('push', (event) => {
  const m = parse(event);
  // Подписка с userVisibleOnly: каждое push-сообщение показывается, даже непонятное.
  const title = m ? m.title : 'SAMBO Digital';
  const tag = m && typeof m.tag === 'string' ? m.tag.slice(0, 200) : undefined;
  const options = {
    body: m ? m.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: safePath(m && m.url) },
  };
  if (tag) {
    options.tag = tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(safePath(data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const own = windows.filter((c) => new URL(c.url).origin === self.location.origin);
      const same = own.find((c) => c.url === target);
      if (same) return same.focus();
      // Открытая вкладка приложения — перейти в ней; не вышло (вкладка не под этим service worker) — новое окно.
      for (const c of own) {
        if (!('navigate' in c)) continue;
        try {
          const moved = await c.navigate(target);
          if (moved) return moved.focus();
        } catch (e) {
          // Следующая вкладка или новое окно.
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// Браузер сменил подписку (истекла, отозвана): подписаться заново тем же ключом сервера. Новый адрес
// привязывается к пользователю при следующем открытии приложения (нужны вход и CSRF — lib/push.ts, syncPush).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      if (event.newSubscription) return;
      const key = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
      if (!key) return;
      await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    })(),
  );
});
