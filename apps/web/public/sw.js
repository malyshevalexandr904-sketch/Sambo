// Service worker Цифровое самбо (Phase 8b): показ push-уведомлений и переход по нажатию. Офлайн-кэша нет —
// запросы страниц он не перехватывает. Сообщение (contracts: PushMessage) — заголовок и текст без имён детей,
// путь в приложении с локалью и метка (новое уведомление о той же схватке заменяет прежнее).
'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Только адрес своего сайта: ссылка из сообщения не уводит на чужой. Проверяется уже разобранный адрес — разбор
 * выбрасывает табуляции и переводы строк, и «/\t/evil.example» иначе стал бы чужим адресом.
 */
function safeUrl(url) {
  try {
    if (typeof url === 'string' && url.startsWith('/')) {
      const u = new URL(url, self.location.origin);
      if (u.origin === self.location.origin) return u.href;
    }
  } catch (e) {
    // Неразборчивая ссылка — главная.
  }
  return new URL('/', self.location.origin).href;
}

/** Адрес из данных показанного уведомления (уже полный): только своего сайта. */
function ownHref(href) {
  try {
    const u = new URL(href);
    if (u.origin === self.location.origin) return u.href;
  } catch (e) {
    // Неразборчивый адрес — главная.
  }
  return new URL('/', self.location.origin).href;
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
  const title = m ? m.title : 'Цифровое самбо';
  const tag = m && typeof m.tag === 'string' ? m.tag.slice(0, 200) : undefined;
  const options = {
    body: m ? m.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: safeUrl(m && m.url) },
  };
  if (tag) {
    options.tag = tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

// Нажатие: вкладка с этой страницей уже открыта — на неё; иначе — новое окно. Открытые вкладки приложения не
// переходят сами: на них может быть недозаполненная форма.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = ownHref(data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = windows.find((c) => c.url === target);
      if (same) return same.focus();
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
