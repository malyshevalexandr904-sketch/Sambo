import { createECDH, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebPushKeyError, webPushKeys } from './web-push-keys.js';

const base = { AUTH_SECRET: 'a'.repeat(48), EMAIL_FROM: 'Цифровое самбо <no-reply@digitalsambo.ru>' };

/** Пара ключей подписывает и проверяет — ключи согласованы (как их проверит push-служба). */
function signsAndVerifies(publicKey: string, privateKey: string): boolean {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
  const pub = Buffer.from(publicKey, 'base64url');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33).toString('base64url'),
  };
  const sign = createSign('SHA256');
  sign.update('vapid');
  const signature = sign.sign({ key: { ...jwk, d: privateKey }, format: 'jwk' });
  const verify = createVerify('SHA256');
  verify.update('vapid');
  return verify.verify({ key: jwk, format: 'jwk' }, signature);
}

describe('VAPID keys', () => {
  it('are derived from AUTH_SECRET deterministically when not configured', () => {
    const a = webPushKeys(base);
    const b = webPushKeys(base);
    expect(a).toEqual(b);
    expect(Buffer.from(a.publicKey, 'base64url')).toHaveLength(65);
    expect(Buffer.from(a.privateKey, 'base64url')).toHaveLength(32);
    expect(signsAndVerifies(a.publicKey, a.privateKey)).toBe(true);
    expect(a.subject).toBe('mailto:no-reply@digitalsambo.ru');
    // Другой секрет — другая пара.
    expect(webPushKeys({ ...base, AUTH_SECRET: 'b'.repeat(48) }).publicKey).not.toBe(a.publicKey);
  });

  it('uses a configured pair and rejects a mismatched one', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const pub = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x as string, 'base64url'),
      Buffer.from(jwk.y as string, 'base64url'),
    ]).toString('base64url');
    const keys = webPushKeys({
      ...base,
      WEB_PUSH_VAPID_PUBLIC_KEY: pub,
      WEB_PUSH_VAPID_PRIVATE_KEY: jwk.d,
      WEB_PUSH_SUBJECT: 'https://digitalsambo.ru',
    });
    expect(keys).toEqual({ publicKey: pub, privateKey: jwk.d, subject: 'https://digitalsambo.ru' });
    expect(() =>
      webPushKeys({
        ...base,
        WEB_PUSH_VAPID_PUBLIC_KEY: webPushKeys(base).publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: jwk.d,
      }),
    ).toThrow(WebPushKeyError);
    for (const bad of ['http://localhost', 'https://', 'https://my host.ru', 'mailto:', 'mailto:no address'])
      expect(() => webPushKeys({ ...base, WEB_PUSH_SUBJECT: bad }), bad).toThrow(WebPushKeyError);
  });
});
