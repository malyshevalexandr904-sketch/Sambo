import { randomBytes } from 'node:crypto';

/** UUIDv7 (RFC 9562): 48 бит времени в мс + случайная часть. Генерирует приложение (ADR-12). */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Публичный идентификатор (DATABASE.md, 1.1): 12 символов base58 (~70 бит), без похожих символов 0/O/I/l.
 * Выборка с отбраковкой — без смещения распределения.
 */
export function publicId(length = 12): string {
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 232 && out.length < length) out += BASE58[b % 58];
    }
  }
  return out;
}
