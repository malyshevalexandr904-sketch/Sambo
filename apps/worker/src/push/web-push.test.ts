import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { describe, expect, it } from 'vitest';
import { guardedLookup, isPublicAddress, PushEndpointRejected, WebPushTransport } from './web-push';

describe('push address guard (SSRF)', () => {
  it('accepts public addresses and rejects private, local and tunnelled ones', () => {
    for (const a of ['142.250.74.10', '2a00:1450:4010:c05::5f']) expect(isPublicAddress(a), a).toBe(true);
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      '2001:0:4136:e378::1',
      'not-an-ip',
    ])
      expect(isPublicAddress(a), a).toBe(false);
  });

  it('the connection lookup refuses a host that resolves to a local address', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      guardedLookup('localhost', {}, (e) => resolve(e)),
    );
    expect(err).toBeInstanceOf(PushEndpointRejected);
    expect(err?.code).toBe('EPUSHHOST');
  });
});

describe('web push transport', () => {
  const keys = { ...webpush.generateVAPIDKeys(), subject: 'mailto:push@sambo.test' };
  const send = async () => ({ statusCode: 201 });

  it('rejects internal endpoints and device keys that are not P-256 points before sending anything', async () => {
    const t = new WebPushTransport(keys, send);
    const opts = { ttlSeconds: 60, urgency: 'normal' as const };
    const good = {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
      auth: 'A'.repeat(22),
    };
    await expect(t.send({ endpoint: 'https://127.0.0.1/x', keys: good }, '{}', opts)).rejects.toBeInstanceOf(
      PushEndpointRejected,
    );
    await expect(
      t.send({ endpoint: 'https://push.example.com/x', keys: good }, '{}', opts),
    ).rejects.toBeInstanceOf(PushEndpointRejected);
    t.close();
  });

  it('a server misconfiguration is not blamed on the device (the subscription is kept, delivery retried)', async () => {
    const device = createECDH('prime256v1');
    const target = {
      endpoint: 'https://push.example.com/x',
      keys: {
        p256dh: device.generateKeys().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    };
    const broken = new WebPushTransport({ ...keys, subject: 'https://my host.ru' }, send);
    const err = await broken
      .send(target, '{}', { ttlSeconds: 60, urgency: 'normal' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PushEndpointRejected);
    broken.close();
    const ok = new WebPushTransport(keys, send);
    await expect(ok.send(target, '{}', { ttlSeconds: 60, urgency: 'normal' })).resolves.toEqual({
      statusCode: 201,
    });
    ok.close();
  });
});
