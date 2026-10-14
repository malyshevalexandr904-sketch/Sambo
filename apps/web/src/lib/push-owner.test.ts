// Чьё устройство (Phase 8b): выход и открытие приложения на общем браузере — с подменёнными API браузера.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn(async (_path: string, _opts?: unknown) => ({ data: { enabled: true, publicKey: KEY } }));
vi.mock('./api', () => ({ api: (path: string, opts?: unknown) => api(path, opts) }));

const KEY = 'BNbxGYNMhEIi9zrneh7mqV4oUanjLUK3m-mYZBc62frMKrEoMk88r3Lk596T0ck9xlT-ZbNxGoW3gHhAHqhb5qI';
const keyBytes = () => Uint8Array.from(Buffer.from(KEY, 'base64url')).buffer;

interface FakeSub {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

let sub: FakeSub | null;
const store = new Map<string, string>();

function fakeSub(endpoint: string): FakeSub {
  return {
    endpoint,
    options: { applicationServerKey: keyBytes() },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } }),
    unsubscribe: vi.fn(async () => {
      sub = null;
      return true;
    }),
  };
}

beforeEach(() => {
  api.mockClear();
  store.clear();
  sub = fakeSub('https://fcm.googleapis.com/fcm/send/shared-tablet');
  const reg = { active: {}, pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
  vi.stubGlobal('window', { isSecureContext: true, PushManager: class {}, Notification: class {} });
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0',
    maxTouchPoints: 0,
    serviceWorker: {
      getRegistration: async () => reg,
      register: async () => reg,
      ready: Promise.resolve(reg),
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

const { disablePushForLogout, syncPush } = await import('./push');
const calls = () =>
  api.mock.calls.map(([path, opts]) => `${(opts as { method?: string })?.method ?? 'GET'} ${path}`);

describe('push device owner', () => {
  it('the owner logging out removes the device on the server and in the browser', async () => {
    store.set('sde_push_owner', 'user-a');
    const s = sub!;
    await disablePushForLogout('user-a');
    expect(calls()).toEqual(['DELETE /me/push/subscriptions']);
    expect(s.unsubscribe).toHaveBeenCalled();
    expect(store.has('sde_push_owner')).toBe(false);
  });

  it('another user logging out on the same browser leaves the owner’s subscription alone', async () => {
    store.set('sde_push_owner', 'user-a');
    const s = sub!;
    await disablePushForLogout('user-b');
    // Своей записи у B нет — сервер ничего не удалит; подписка браузера и отметка владельца остаются.
    expect(calls()).toEqual(['DELETE /me/push/subscriptions']);
    expect(s.unsubscribe).not.toHaveBeenCalled();
    expect(store.get('sde_push_owner')).toBe('user-a');
  });

  it('opening the app: the owner re-binds the device explicitly, anyone else only with onlyIfMine', async () => {
    store.set('sde_push_owner', 'user-a');
    await syncPush('user-a');
    const own = api.mock.calls.find(([, o]) => (o as { method?: string })?.method === 'PUT')?.[1] as {
      body: Record<string, unknown>;
    };
    expect(own.body).not.toHaveProperty('onlyIfMine');
    api.mockClear();
    await syncPush('user-b');
    const other = api.mock.calls.find(([, o]) => (o as { method?: string })?.method === 'PUT')?.[1] as {
      body: Record<string, unknown>;
    };
    expect(other.body).toMatchObject({ onlyIfMine: true });
  });
});
