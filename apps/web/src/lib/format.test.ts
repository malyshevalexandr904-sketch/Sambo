import { describe, expect, it } from 'vitest';
import { describeUserAgent, formatSessionRange } from './format';

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36',
      'Chrome 141 · Linux',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      'Edge 140 · Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 YaBrowser/25.8.0.0 Safari/537.36',
      'Yandex Browser 25 · Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
      'Safari 18 · macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      'Safari 18 · iOS',
    ],
    ['Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0', 'Firefox 142 · Android'],
    ['curl/8.5.0', 'curl/8.5.0'],
    [null, '—'],
  ])('%s → %s', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });
});

describe('formatSessionRange', () => {
  it('shows the date once for a same-day session, in the tournament time zone', () => {
    // 06:00–16:00 UTC = 09:00–19:00 по Москве (UTC+3), та же дата.
    expect(formatSessionRange('2026-10-04T06:00:00Z', '2026-10-04T16:00:00Z', 'Europe/Moscow', 'ru')).toBe(
      '4 окт. 2026 г., 09:00 – 19:00',
    );
  });

  it('shows both dates when the session crosses midnight in the tournament time zone', () => {
    // 20:00 UTC = 23:00 МСК 4 октября; 03:00 UTC = 06:00 МСК 5 октября.
    const text = formatSessionRange('2026-10-04T20:00:00Z', '2026-10-05T03:00:00Z', 'Europe/Moscow', 'ru');
    expect(text).toContain('4 окт. 2026 г.');
    expect(text).toContain('5 окт. 2026 г.');
    expect(text).toContain('23:00');
    expect(text).toContain('06:00');
  });

  it('uses the tournament zone for the day, not the viewer zone', () => {
    // 21:30 UTC уже 5 октября по Москве, а в UTC ещё 4-е.
    const text = formatSessionRange('2026-10-04T21:30:00Z', '2026-10-04T22:30:00Z', 'Europe/Moscow', 'ru');
    expect(text.startsWith('5 окт. 2026 г.')).toBe(true);
  });
});
