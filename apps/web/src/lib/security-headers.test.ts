import { describe, expect, it } from 'vitest';
import { PERMISSIONS_POLICY, SECURITY_HEADERS } from './security-headers';

/** Разбор Permissions-Policy: `feature=(allowlist)` через запятую. */
function parsePolicy(value: string): Map<string, string[]> {
  return new Map(
    value.split(',').map((part) => {
      const [feature = '', list = ''] = part.trim().split('=');
      return [feature, list.replace(/[()]/g, '').split(/\s+/).filter(Boolean)];
    }),
  );
}

describe('security headers', () => {
  it('разрешает камеру только своему origin — для сканера QR', () => {
    const policy = parsePolicy(PERMISSIONS_POLICY);
    expect(policy.get('camera')).toEqual(['self']);
  });

  it('микрофон и геолокация запрещены всем', () => {
    const policy = parsePolicy(PERMISSIONS_POLICY);
    expect(policy.get('microphone')).toEqual([]);
    expect(policy.get('geolocation')).toEqual([]);
  });

  it('отдаёт Permissions-Policy, nosniff и HSTS', () => {
    const byKey = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey.get('Permissions-Policy')).toBe(PERMISSIONS_POLICY);
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('Strict-Transport-Security')).toMatch(/^max-age=\d+/);
  });
});
