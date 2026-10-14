// Отправка Web Push (Phase 8b; RFC 8030, 8291, 8292): шифрование сообщения ключами устройства и подпись VAPID —
// библиотека web-push. Адрес push-службы прислал браузер пользователя, поэтому соединение защищено от SSRF: имя
// хоста проверяется заранее (contracts: pushEndpointProblem), а адрес, в который оно разрешилось, — при самом
// подключении (lookup агента): внутренние и служебные адреса отклоняются, подмена DNS между проверкой и запросом
// не помогает.
import { ECDH } from 'node:crypto';
import { type LookupAddress, lookup as dnsLookup } from 'node:dns';
import { Agent, request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { pushEndpointProblem } from '@sde/contracts';
import type { WebPushKeys } from '@sde/server-kit';
import webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSendOptions {
  /** Сколько push-служба хранит сообщение, пока устройство недоступно (секунды). */
  ttlSeconds: number;
  urgency: 'normal' | 'high';
  /** Метка: новое сообщение с той же меткой заменяет недоставленное прежнее. */
  topic?: string;
}

/** Ответ push-службы: 201 — принято; 404/410 — подписки больше нет; прочее — сбой (повтор). */
export interface PushTransport {
  send(target: PushTarget, payload: string, opts: PushSendOptions): Promise<{ statusCode: number }>;
}

export class PushEndpointRejected extends Error {}

/** Адреса, куда push не отправляется: локальные, частные, служебные (IPv4 и IPv6). */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
  // 6to4 и Teredo: внутри — IPv4-адрес, проверить его здесь нельзя.
  ['2002::', 16],
  ['2001::', 32],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

/** Адрес можно использовать: публичный (IPv4-адрес внутри IPv6 — тоже проверяется). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    if (mapped) return !BLOCKED.check(mapped, 'ipv4');
    return !BLOCKED.check(address, 'ipv6');
  }
  return false;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** lookup для агента: разрешённые адреса — только публичные, иначе соединение не открывается. */
export function guardedLookup(hostname: string, options: object, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses;
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0)
      return callback(
        Object.assign(new PushEndpointRejected(`push endpoint resolves to ${bad?.address ?? 'nothing'}`), {
          code: 'EPUSHHOST',
        }),
        [],
      );
    if ((options as { all?: boolean }).all) return callback(null, list);
    const first = list[0] as LookupAddress;
    return callback(null, first.address, first.family);
  });
}

/** Ключи устройства по RFC 8291: точка P-256 без сжатия и секрет 16 байт; иначе — причина отказа. */
export function deviceKeysProblem(keys: PushTarget['keys']): string | null {
  try {
    ECDH.convertKey(Buffer.from(keys.p256dh, 'base64url'), 'prime256v1');
  } catch {
    return 'push subscription p256dh is not a P-256 point';
  }
  if (Buffer.from(keys.auth, 'base64url').length !== 16) return 'push subscription auth is not 16 bytes';
  return null;
}

/** Запрос к push-службе: зашифрованное тело и заголовки (VAPID, TTL, Urgency, Topic). */
export interface PushRequest {
  endpoint: string;
  headers: Record<string, string | number>;
  body: Buffer;
}

/** Отправка запроса push-службе; подменяется в тестах (расшифровка тестовым «устройством»). */
export type PushRequester = (req: PushRequest) => Promise<{ statusCode: number }>;

/** HTTPS-запрос через агент с проверкой адресов, таймаут 10 с; тело ответа не нужно. */
function httpsRequester(agent: Agent): PushRequester {
  return (req) =>
    new Promise((resolve, reject) => {
      const r = request(
        req.endpoint,
        { method: 'POST', headers: req.headers, agent, timeout: 10_000 },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
        },
      );
      r.on('timeout', () => r.destroy(new Error('push request timeout')));
      r.on('error', reject);
      r.end(req.body);
    });
}

/** Транспорт web-push: VAPID, aes128gcm, таймаут 10 с, агент с проверкой адресов. */
export class WebPushTransport implements PushTransport {
  private readonly agent = new Agent({ keepAlive: true, lookup: guardedLookup, timeout: 10_000 });
  private readonly requester: PushRequester;

  constructor(
    private readonly keys: WebPushKeys,
    requester?: PushRequester,
  ) {
    this.requester = requester ?? httpsRequester(this.agent);
  }

  async send(target: PushTarget, payload: string, opts: PushSendOptions): Promise<{ statusCode: number }> {
    const problem = pushEndpointProblem(target.endpoint);
    if (problem) throw new PushEndpointRejected(problem);
    // Ключи устройства — до библиотеки: ключ не на кривой P-256 (или секрет не 16 байт) зашифровать нельзя никогда —
    // подписка негодна. Остальные ошибки библиотеки (настройка сервера) — не повод удалять устройства.
    const keysProblem = deviceKeysProblem(target.keys);
    if (keysProblem) throw new PushEndpointRejected(keysProblem);
    const details = webpush.generateRequestDetails(target, payload, {
      vapidDetails: {
        subject: this.keys.subject,
        publicKey: this.keys.publicKey,
        privateKey: this.keys.privateKey,
      },
      TTL: opts.ttlSeconds,
      urgency: opts.urgency,
      topic: opts.topic,
      contentEncoding: 'aes128gcm',
    });
    return this.requester({
      endpoint: details.endpoint,
      headers: details.headers,
      body: details.body ?? Buffer.alloc(0),
    });
  }

  close(): void {
    this.agent.destroy();
  }
}
