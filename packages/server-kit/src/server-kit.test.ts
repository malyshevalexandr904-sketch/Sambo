import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { deriveKey, open, openJson, seal, sealJson } from './crypto.js';
import { InvalidEnvironmentError, loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { LocalLeakedPasswordChecker, hashPassword, passwordNeedsRehash, verifyPassword } from './password.js';
import { generateRecoveryCodes, hashRecoveryCode, openTotpSecret, sealTotpSecret } from './totp.js';

const key = deriveKey('x'.repeat(40), 'test');

describe('AES-256-GCM seal/open', () => {
  it('round-trips and binds AAD', () => {
    const sealed = seal(key, 'secret', 'ctx');
    expect(open(key, sealed, 'ctx').toString()).toBe('secret');
    expect(() => open(key, sealed, 'other')).toThrow();
  });
  it('detects tampering', () => {
    const sealed = seal(key, 'secret');
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 1;
    expect(() => open(key, sealed)).toThrow();
  });
  it('seals JSON for outbox', () => {
    const s = sealJson(key, { url: 'https://x/verify?t=abc' }, 'evt');
    expect(openJson<{ url: string }>(key, s, 'evt').url).toContain('t=abc');
  });
  it('binds TOTP secret to user id', () => {
    const sealed = sealTotpSecret(key, 'user-1', 'JBSWY3DPEHPK3PXP');
    expect(openTotpSecret(key, 'user-1', sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => openTotpSecret(key, 'user-2', sealed)).toThrow();
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('Correct-Horse-2026');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Correct-Horse-2026')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
    expect(passwordNeedsRehash(hash)).toBe(false);
  });
  it('rejects common passwords', async () => {
    const checker = new LocalLeakedPasswordChecker();
    expect(await checker.isLeaked('Qwerty123456')).toBe(true);
    expect(await checker.isLeaked('aaaaaaaaaaaa')).toBe(true);
    expect(await checker.isLeaked('Lemon-Tatami-Throw-42')).toBe(false);
  });
  it('generates unique recovery codes', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(hashes[0]).toBe(hashRecoveryCode(codes[0]!.toLowerCase()));
  });
});

describe('environment', () => {
  const valid = {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://u:p@localhost/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'j'.repeat(32),
    AUTH_SECRET: 'a'.repeat(32),
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_ACCESS_KEY: 'k',
    STORAGE_SECRET_KEY: 's',
    STORAGE_BUCKET_PUBLIC: 'pub',
    STORAGE_BUCKET_PRIVATE: 'priv',
    STORAGE_BUCKET_GENERATED: 'gen',
    STORAGE_PUBLIC_URL: 'http://localhost:9000/pub',
    EMAIL_PROVIDER: 'log',
  };
  it('parses a valid environment', () => {
    const env = loadEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(true);
  });
  it('fails fast without leaking values', () => {
    try {
      loadEnv({ ...valid, JWT_SECRET: 'short-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidEnvironmentError);
      expect(String(e)).toContain('JWT_SECRET');
      expect(String(e)).not.toContain('short-secret-value');
    }
  });
  it('requires SMTP host for smtp provider', () => {
    expect(() => loadEnv({ ...valid, EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/);
  });
});

describe('log redaction (SECURITY.md, 7)', () => {
  it('never writes secrets or personal data', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger('info', 'test', sink);
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'sde_at=xyz' }, body: { password: 'p' } },
        user: { email: 'kid@example.ru', lastName: 'Иванов', birthDate: '2012-01-01' },
        token: 'raw-token',
      },
      'request',
    );
    const out = lines.join('');
    for (const leaked of ['Bearer abc', 'sde_at=xyz', 'kid@example.ru', 'Иванов', '2012-01-01', 'raw-token']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('[REDACTED]');
  });
});
