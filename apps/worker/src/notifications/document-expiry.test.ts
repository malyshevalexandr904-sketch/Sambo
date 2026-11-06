import { describe, expect, it } from 'vitest';
import { daysUntil, expiryStage, expirySourceKey } from './document-expiry';
import { renderPush } from './push-templates';
import { renderNotificationEmail } from './templates';

describe('expiryStage', () => {
  const today = '2026-11-05';
  it('counts whole days, the expiry day itself is 0', () => {
    expect(daysUntil('2026-11-05', today)).toBe(0);
    expect(daysUntil('2026-12-05', today)).toBe(30);
    expect(daysUntil('2026-11-04', today)).toBe(-1);
  });

  it('picks the nearest threshold', () => {
    expect(expiryStage('2026-12-06', today)).toBeNull();
    expect(expiryStage('2026-12-05', today)).toBe('d30');
    expect(expiryStage('2026-11-13', today)).toBe('d30');
    expect(expiryStage('2026-11-12', today)).toBe('d7');
    expect(expiryStage('2026-11-06', today)).toBe('d1');
    expect(expiryStage('2026-11-05', today)).toBe('d1');
    expect(expiryStage('2026-11-04', today)).toBe('expired');
    expect(expiryStage('2026-10-06', today)).toBe('expired');
    expect(expiryStage('2026-10-05', today)).toBeNull();
  });

  it('gives a stable source key per document and stage', () => {
    const id = '0190a0a0-0000-7000-8000-000000000001';
    expect(expirySourceKey(id, 'd7')).toBe(expirySourceKey(id, 'd7'));
    expect(expirySourceKey(id, 'd7')).not.toBe(expirySourceKey(id, 'd1'));
  });
});

describe('expiry texts', () => {
  it('renders email with a human date', () => {
    const mail = renderNotificationEmail('document.expiring', 'ru', {
      documentType: 'Полис ОМС',
      expirationDate: '2026-11-12',
      url: 'https://example.org/ru/my-documents',
    });
    expect(mail.text).toContain('12.11.2026');
    expect(mail.text).toContain('Полис ОМС');
  });

  it('renders push', () => {
    const push = renderPush('document.expiring', {
      locale: 'ru',
      documentType: 'Полис ОМС',
      expirationDate: '2026-11-12',
    });
    expect(push.body).toBe('Полис ОМС · до 12.11.2026');
  });
});
