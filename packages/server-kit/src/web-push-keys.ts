// Ключи VAPID для Web Push (Phase 8b; RFC 8292): пара P-256. Заданы в окружении — берутся оттуда; иначе выводятся
// из AUTH_SECRET (HKDF), чтобы уже работающая установка получила push без новых секретов. Смена AUTH_SECRET меняет
// пару — прежние подписки устройств перестают приниматься push-службами, браузеры подписываются заново.
import { createECDH, hkdfSync } from 'node:crypto';

/** Порядок группы P-256: закрытый ключ — число от 1 до n − 1. */
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

export interface WebPushKeys {
  /** Открытый ключ: точка P-256 без сжатия (65 байт), base64url. */
  publicKey: string;
  /** Закрытый ключ: 32 байта, base64url. */
  privateKey: string;
  /** Контакт отправителя для push-служб: `mailto:` или `https:`. */
  subject: string;
}

export interface WebPushEnv {
  AUTH_SECRET: string;
  EMAIL_FROM: string;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string | undefined;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string | undefined;
  WEB_PUSH_SUBJECT?: string | undefined;
}

export class WebPushKeyError extends Error {}

function publicKeyOf(privateKey: Buffer): Buffer {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privateKey);
  return ecdh.getPublicKey(null, 'uncompressed');
}

/** Закрытый ключ из секрета: HKDF; число вне диапазона (вероятность ~2⁻³²) — следующая попытка. */
export function deriveVapidPrivateKey(secret: string): Buffer {
  for (let i = 0; i < 16; i++) {
    const d = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `sde:web-push-vapid:${i}`, 32));
    const n = BigInt(`0x${d.toString('hex')}`);
    if (n > 0n && n < P256_ORDER) return d;
  }
  throw new WebPushKeyError('cannot derive a VAPID key from AUTH_SECRET');
}

/** Адрес из EMAIL_FROM («Имя <адрес>» или просто адрес) — контакт `mailto:` по умолчанию. */
function defaultSubject(emailFrom: string): string {
  const address = /<([^>]+)>/.exec(emailFrom)?.[1] ?? emailFrom;
  return `mailto:${address.trim()}`;
}

export function webPushKeys(env: WebPushEnv): WebPushKeys {
  const subject = env.WEB_PUSH_SUBJECT ?? defaultSubject(env.EMAIL_FROM);
  if (!/^(mailto:|https:\/\/)/.test(subject))
    throw new WebPushKeyError('WEB_PUSH_SUBJECT must start with mailto: or https://');
  if (env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY) {
    const priv = Buffer.from(env.WEB_PUSH_VAPID_PRIVATE_KEY, 'base64url');
    const pub = Buffer.from(env.WEB_PUSH_VAPID_PUBLIC_KEY, 'base64url');
    if (priv.length !== 32 || pub.length !== 65 || pub[0] !== 4)
      throw new WebPushKeyError('WEB_PUSH_VAPID_* must be a P-256 key pair in base64url (32 and 65 bytes)');
    if (!publicKeyOf(priv).equals(pub))
      throw new WebPushKeyError('WEB_PUSH_VAPID_PUBLIC_KEY does not match WEB_PUSH_VAPID_PRIVATE_KEY');
    return { publicKey: pub.toString('base64url'), privateKey: priv.toString('base64url'), subject };
  }
  const priv = deriveVapidPrivateKey(env.AUTH_SECRET);
  return {
    publicKey: publicKeyOf(priv).toString('base64url'),
    privateKey: priv.toString('base64url'),
    subject,
  };
}
