import { describe, expect, it } from 'vitest';
import { nestQuotes, renderEmail, TemplateParamsError } from './templates';

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

  it('uses „inner“ quotes inside «outer» ones in Russian', () => {
    const r = renderEmail('organization.invite', 'ru', {
      acceptUrl: 'https://sambo.local/ru/invites/accept?token=t',
      organizationName: 'Спортивный клуб «Буревестник»',
      roleCode: 'CLUB_MANAGER',
    });
    expect(r.subject).toBe('Приглашение в «Спортивный клуб „Буревестник“» — SAMBO Digital');
    expect(r.text).toContain('в организацию «Спортивный клуб „Буревестник“» с ролью');
    expect(r.html).toContain('«Спортивный клуб „Буревестник“»');
    expect(nestQuotes('«a «b «c»» d»')).toBe('«a „b „c““ d»');
    expect(nestQuotes('без кавычек » и «')).toBe('без кавычек » и «');
  });

  it('rejects missing params and non-http links', () => {
    expect(() => renderEmail('auth.password_reset', 'ru', {})).toThrow(TemplateParamsError);
    expect(() => renderEmail('auth.password_reset', 'ru', { resetUrl: 'javascript:alert(1)' })).toThrow(
      TemplateParamsError,
    );
  });

  it('renders the guardian invitation without the child data and the rejection with the reason', () => {
    const invite = renderEmail('guardian.invite', 'ru', {
      acceptUrl: 'https://sambo.local/ru/invites/guardian?token=t',
      organizationName: 'Клуб «Витязь»',
    });
    expect(invite.text).toContain('«Клуб „Витязь“» указал(а) вас законным представителем');
    const rejected = renderEmail('document.rejected', 'en', {
      documentType: 'Medical certificate',
      reason: 'Stamp is not readable',
      documentsUrl: 'https://sambo.local/en/documents',
    });
    expect(rejected.text).toContain('Reason: Stamp is not readable');
    expect(() =>
      renderEmail('document.rejected', 'ru', { documentType: 'x', documentsUrl: 'https://a' }),
    ).toThrow(TemplateParamsError);
  });
});
