// Шифрование секрета TOTP (AES-256-GCM, ключ TOTP_ENCRYPTION_KEY) и коды восстановления.
import { randomInt } from 'node:crypto';
import { open, seal, sha256Hex } from './crypto.js';

export function totpKey(base64Key: string): Buffer {
  return Buffer.from(base64Key, 'base64');
}

/** userId в AAD: зашифрованный секрет нельзя перенести в строку другого пользователя. */
export function sealTotpSecret(key: Buffer, userId: string, secret: string): Buffer {
  return seal(key, secret, `totp:${userId}`);
}

export function openTotpSecret(key: Buffer, userId: string, sealed: Uint8Array): string {
  return open(key, Buffer.from(sealed), `totp:${userId}`).toString('utf8');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChunk(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** 10 одноразовых кодов формата XXXXX-XXXXX (ARCHITECTURE.md, 6). В БД — только SHA-256. */
export function generateRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => `${randomChunk(5)}-${randomChunk(5)}`);
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(code.trim().toUpperCase());
}
