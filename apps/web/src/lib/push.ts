// Web Push в браузере (Phase 8b): подписка этого устройства, отписка, привязка к текущей сессии входа. Отправляет
// push worker (apps/worker/src/push); service worker /sw.js показывает уведомление и открывает ссылку.
//
// Чьё устройство: отметка в localStorage — пользователь, включивший push на этом браузере. Его устройство при
// открытии приложения после нового входа привязывается к новой сессии; чужое (другой пользователь вошёл на том
// же браузере) — только `onlyIfMine`: сервер его не отдаст, пока новый пользователь не включит push сам.
import type { DataEnvelope, PushConfigDto, PushSubscriptionPut } from '@sde/contracts';
import { api } from './api';

const OWNER_KEY = 'sde_push_owner';
const SW_URL = '/sw.js';

export type PushSupport = 'supported' | 'unsupported' | 'ios-home-screen';

export class PushPermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(`notification permission: ${permission}`);
  }
}

/** iPhone/iPad (и iPad, представляющийся Mac). */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Можно ли включить push здесь: на iPhone/iPad — только у сайта на экране «Домой» (iOS 16.4+). */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const api = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (api && window.isSecureContext) return 'supported';
  if (isIos() && !standalone()) return 'ios-home-screen';
  return 'unsupported';
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Хранилище недоступно (приватный режим): устройство привяжется при следующем явном включении.
  }
}

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(key: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = base64UrlToBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Тело запроса подписки: адрес push-службы и ключи устройства (без expirationTime). */
export function subscriptionBody(sub: PushSubscription, onlyIfMine = false): PushSubscriptionPut {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    ...(onlyIfMine ? { onlyIfMine: true } : {}),
  };
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing?.active) return existing;
  await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  return navigator.serviceWorker.ready;
}

export async function pushConfig(): Promise<PushConfigDto> {
  return (await api<DataEnvelope<PushConfigDto>>('/me/push/config')).data;
}

/** Подписка этого браузера (если есть). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Подписка браузера под ключ сервера: прежняя с другим ключом (смена ключей сервера) заменяется. */
async function subscribeBrowser(publicKey: string): Promise<PushSubscription> {
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (sub && sameKey(sub.options.applicationServerKey, publicKey)) return sub;
  await sub?.unsubscribe();
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
}

/** «Получать уведомления на этом устройстве»: разрешение браузера, подписка, регистрация на сервере. */
export async function enablePush(userId: string, publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushPermissionError(permission);
  const sub = await subscribeBrowser(publicKey);
  await api('/me/push/subscriptions', { method: 'PUT', body: subscriptionBody(sub) });
  writeOwner(userId);
}

/** «Не получать на этом устройстве» и выход из системы: снять подписку на сервере и в браузере. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  writeOwner(null);
  if (!sub) return;
  try {
    await api('/me/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  } finally {
    await sub.unsubscribe().catch(() => false);
  }
}

/**
 * Выход пользователя `userId` (не дольше `ms` — выход не ждёт медленный service worker). Своё устройство — подписка
 * снимается и на сервере, и в браузере. Устройство другого пользователя (общий планшет семьи: push включил другой) —
 * на сервере снимается только запись этого пользователя, если она есть; подписка браузера и отметка владельца
 * остаются — владелец, войдя снова, получает push без повторного включения.
 */
export async function disablePushForLogout(userId: string, ms = 3000): Promise<void> {
  if (pushSupport() !== 'supported') return;
  const work = async (): Promise<void> => {
    if (readOwner() === userId) return disablePush();
    const sub = await currentSubscription();
    if (sub) await api('/me/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  };
  await Promise.race([work().catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);
}

/**
 * Открытие приложения: устройство этого пользователя — привязать к текущей сессии (после нового входа) и под
 * текущий ключ сервера; устройство без отметки — только если сервер знает его как устройство этого пользователя.
 */
export async function syncPush(userId: string): Promise<void> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return;
  const existing = await currentSubscription();
  const mine = readOwner() === userId;
  if (!existing && !mine) return;
  const config = await pushConfig();
  if (!config.enabled || !config.publicKey) return;
  if (mine) {
    const sub = await subscribeBrowser(config.publicKey);
    await api('/me/push/subscriptions', { method: 'PUT', body: subscriptionBody(sub) });
    return;
  }
  if (existing)
    await api('/me/push/subscriptions', { method: 'PUT', body: subscriptionBody(existing, true) });
}

/** Включён ли push на этом устройстве для пользователя (для кнопки в настройках). */
export async function enabledHere(userId: string): Promise<boolean> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return false;
  return readOwner() === userId && (await currentSubscription()) !== null;
}

/** «Chrome · Android» из User-Agent: только для подписи устройства в списке. */
export function deviceName(ua: string | null): { browser: string; os: string } | null {
  if (!ua) return null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const browser = /YaBrowser\//.test(ua)
    ? 'Яндекс Браузер'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  return browser && os ? { browser, os } : null;
}
