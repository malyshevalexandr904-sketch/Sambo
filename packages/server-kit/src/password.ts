// Хеширование паролей: argon2id с параметрами OWASP (ARCHITECTURE.md, 6).
import argon2 from 'argon2';
import { COMMON_PASSWORDS } from './common-passwords.js';

/** OWASP Password Storage Cheat Sheet: m = 19 MiB, t = 2, p = 1. */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_PARAMS);
}

let dummyHash: Promise<string> | null = null;

/**
 * Выполняет проверку пароля против фиктивного хеша: ответ для несуществующего email
 * занимает столько же времени, сколько для существующего (API.md, 3.1).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  await verifyPassword(await dummyHash, password);
}

/**
 * Проверка по локальному списку распространённых и утёкших паролей.
 * Точка расширения: офлайн-база k-anonymity (HIBP) подключается через этот же интерфейс.
 */
export interface LeakedPasswordChecker {
  isLeaked(password: string): Promise<boolean>;
}

export class LocalLeakedPasswordChecker implements LeakedPasswordChecker {
  async isLeaked(password: string): Promise<boolean> {
    const normalized = password.trim().toLowerCase();
    if (COMMON_PASSWORDS.has(normalized)) return true;
    // Очевидные шаблоны: один символ или простая последовательность.
    if (/^(.)\1+$/.test(normalized)) return true;
    return (
      '0123456789012345678901234567890'.includes(normalized) ||
      'qwertyuiopasdfghjklzxcvbnm'.includes(normalized)
    );
  }
}
