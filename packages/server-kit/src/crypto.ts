// Криптографические примитивы: токены, хеши, AES-256-GCM (ARCHITECTURE.md, 6; SECURITY.md, 8).
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Случайный токен в base64url. 32 байта = 256 бит (refresh token, одноразовые ссылки). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 в виде Uint8Array (формат колонок bytea в Prisma). */
export function sha256(value: string | Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(value).digest());
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(key: string | Buffer, value: string | Buffer): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Производный ключ из секрета окружения для отдельной цели (разные ключи — разные назначения). */
export function deriveKey(secret: string, purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `sde:${purpose}`, length));
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 1;

/** AES-256-GCM: [version(1) | iv(12) | tag(16) | ciphertext]. `aad` связывает шифротекст с контекстом. */
export function seal(key: Buffer, plaintext: Buffer | string, aad?: string): Buffer {
  if (key.length !== 32) throw new Error('seal: key must be 32 bytes');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]);
}

export function open(key: Buffer, sealed: Buffer, aad?: string): Buffer {
  if (key.length !== 32) throw new Error('open: key must be 32 bytes');
  if (sealed.length < 1 + IV_LENGTH + TAG_LENGTH || sealed[0] !== VERSION) {
    throw new Error('open: unsupported payload');
  }
  const iv = sealed.subarray(1, 1 + IV_LENGTH);
  const tag = sealed.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const data = sealed.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Запечатанные параметры писем в outbox (EVENT_SCHEMAS['email.requested'].sealedParams). */
export function sealJson(key: Buffer, value: unknown, aad: string): string {
  return seal(key, JSON.stringify(value), aad).toString('base64url');
}

export function openJson<T>(key: Buffer, sealed: string, aad: string): T {
  return JSON.parse(open(key, Buffer.from(sealed, 'base64url'), aad).toString('utf8')) as T;
}

export const KEY_PURPOSES = {
  outboxSecrets: 'outbox-secrets',
  csrf: 'csrf',
  qr: 'qr',
} as const;
