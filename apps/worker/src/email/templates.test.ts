import { describe, expect, it } from 'vitest';
import { renderEmail, TemplateParamsError } from './templates';

describe('email templates', () => {
  it('renders ru and en with the action link', () => {
    const ru = renderEmail('auth.verify_email', 'ru', {
      verifyUrl: 'https://sambo.local/ru/verify-email?token=abc',
      displayName: 'Иван',
    });
    expect(ru.subject).toContain('Подтвердите email');
    expect(ru.text).toContain('https://sambo.local/ru/verify-email?token=abc');
    const en = renderEmail('auth.password_reset', 'en', {
      resetUrl: 'https://sambo.local/en/reset-password?token=x',
    });
    expect(en.subject).toContain('Password reset');
  });

  it('escapes HTML in parameters', () => {
    const r = renderEmail('organization.invite', 'ru', {
      acceptUrl: 'https://sambo.local/ru/invites/accept?token=t',
      organizationName: '<script>alert(1)</script>',
      roleCode: 'COACH',
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.text).toContain('«тренер»');
  });

  it('rejects missing params and non-http links', () => {
    expect(() => renderEmail('auth.password_reset', 'ru', {})).toThrow(TemplateParamsError);
    expect(() => renderEmail('auth.password_reset', 'ru', { resetUrl: 'javascript:alert(1)' })).toThrow(
      TemplateParamsError,
    );
  });
});
