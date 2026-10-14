import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, deviceName } from './push';

describe('push helpers', () => {
  it('decodes the VAPID public key (base64url without padding) into the 65-byte P-256 point', () => {
    const key = 'BNbxGYNMhEIi9zrneh7mqV4oUanjLUK3m-mYZBc62frMKrEoMk88r3Lk596T0ck9xlT-ZbNxGoW3gHhAHqhb5qI';
    const bytes = base64UrlToBytes(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(Buffer.from(bytes).toString('base64url')).toBe(key);
  });

  it('names a device by its browser and system, without the full User-Agent', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', os: 'Android' });
    expect(
      deviceName(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(
      deviceName(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 YaBrowser/24.10 Safari/537.36',
      ),
    ).toEqual({ browser: 'Яндекс Браузер', os: 'Windows' });
    expect(deviceName(null)).toBeNull();
    expect(deviceName('curl/8.0')).toBeNull();
  });
});
