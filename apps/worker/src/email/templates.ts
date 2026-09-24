// Шаблоны писем по локалям (ADR-17). В письмах нет ПДн детей (SECURITY.md, 3.7).
import type { EmailTemplate, Locale } from '@sde/contracts';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type Params = Record<string, string>;

const escapeHtml = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface TemplateDef {
  subject: string;
  lines: string[];
  action?: { label: string; param: string };
  required: string[];
}

const ROLE_NAMES: Record<Locale, Record<string, string>> = {
  ru: {
    FEDERATION_ADMIN: 'администратор федерации',
    ORGANIZER: 'организатор',
    COACH: 'тренер',
    CLUB_MANAGER: 'руководитель клуба',
  },
  en: {
    FEDERATION_ADMIN: 'federation administrator',
    ORGANIZER: 'organizer',
    COACH: 'coach',
    CLUB_MANAGER: 'club manager',
  },
};

const TEMPLATES: Record<Locale, Record<EmailTemplate, TemplateDef>> = {
  ru: {
    'auth.verify_email': {
      subject: 'Подтвердите email — SAMBO Digital',
      lines: [
        'Здравствуйте, {displayName}!',
        'Чтобы завершить регистрацию, подтвердите адрес электронной почты. Ссылка действует 24 часа.',
      ],
      action: { label: 'Подтвердить email', param: 'verifyUrl' },
      required: ['verifyUrl', 'displayName'],
    },
    'auth.account_exists': {
      subject: 'У вас уже есть аккаунт — SAMBO Digital',
      lines: [
        'Кто-то попытался зарегистрироваться с этим адресом, но аккаунт уже существует.',
        'Если это были вы — войдите или восстановите пароль. Если нет — просто проигнорируйте письмо.',
      ],
      action: { label: 'Восстановить пароль', param: 'resetUrl' },
      required: ['resetUrl', 'loginUrl'],
    },
    'auth.password_reset': {
      subject: 'Восстановление пароля — SAMBO Digital',
      lines: [
        'Мы получили запрос на смену пароля. Ссылка действует 1 час.',
        'Если вы не запрашивали смену пароля, проигнорируйте письмо.',
      ],
      action: { label: 'Задать новый пароль', param: 'resetUrl' },
      required: ['resetUrl'],
    },
    'auth.password_changed': {
      subject: 'Пароль изменён — SAMBO Digital',
      lines: [
        'Пароль вашего аккаунта был изменён, другие сеансы завершены.',
        'Если это были не вы, немедленно восстановите пароль и сообщите администратору.',
      ],
      action: { label: 'Восстановить пароль', param: 'resetUrl' },
      required: ['resetUrl'],
    },
    'organization.invite': {
      subject: 'Приглашение в «{organizationName}» — SAMBO Digital',
      lines: [
        'Вас пригласили в организацию «{organizationName}» с ролью «{roleName}».',
        'Ссылка действует 7 дней. Войдите или зарегистрируйтесь с этим адресом email, чтобы принять приглашение.',
      ],
      action: { label: 'Принять приглашение', param: 'acceptUrl' },
      required: ['acceptUrl', 'organizationName', 'roleCode'],
    },
  },
  en: {
    'auth.verify_email': {
      subject: 'Confirm your email — SAMBO Digital',
      lines: [
        'Hello, {displayName}!',
        'Please confirm your email address to finish signing up. The link is valid for 24 hours.',
      ],
      action: { label: 'Confirm email', param: 'verifyUrl' },
      required: ['verifyUrl', 'displayName'],
    },
    'auth.account_exists': {
      subject: 'You already have an account — SAMBO Digital',
      lines: [
        'Someone tried to sign up with this address, but an account already exists.',
        'If it was you, sign in or reset your password. Otherwise, ignore this email.',
      ],
      action: { label: 'Reset password', param: 'resetUrl' },
      required: ['resetUrl', 'loginUrl'],
    },
    'auth.password_reset': {
      subject: 'Password reset — SAMBO Digital',
      lines: [
        'We received a request to reset your password. The link is valid for 1 hour.',
        'If you did not request it, ignore this email.',
      ],
      action: { label: 'Set a new password', param: 'resetUrl' },
      required: ['resetUrl'],
    },
    'auth.password_changed': {
      subject: 'Password changed — SAMBO Digital',
      lines: [
        'Your password was changed and other sessions were signed out.',
        'If this was not you, reset your password immediately and contact the administrator.',
      ],
      action: { label: 'Reset password', param: 'resetUrl' },
      required: ['resetUrl'],
    },
    'organization.invite': {
      subject: 'Invitation to “{organizationName}” — SAMBO Digital',
      lines: [
        'You have been invited to “{organizationName}” as {roleName}.',
        'The link is valid for 7 days. Sign in or sign up with this email address to accept.',
      ],
      action: { label: 'Accept invitation', param: 'acceptUrl' },
      required: ['acceptUrl', 'organizationName', 'roleCode'],
    },
  },
};

export class TemplateParamsError extends Error {}

/**
 * Русская типографика: кавычки внутри «ёлочек» — „лапки“. Названия организаций сами содержат
 * кавычки («Спортивный клуб «Буревестник»»), поэтому вложенность выравнивается после подстановки.
 */
export function nestQuotes(text: string): string {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if (ch === '«') {
      depth += 1;
      out += depth > 1 ? '„' : ch;
    } else if (ch === '»' && depth > 0) {
      out += depth > 1 ? '“' : ch;
      depth -= 1;
    } else {
      out += ch;
    }
  }
  return out;
}

function fill(text: string, params: Params, escape: boolean, locale: Locale): string {
  const filled = text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? '');
  const typographed = locale === 'ru' ? nestQuotes(filled) : filled;
  return escape ? escapeHtml(typographed) : typographed;
}

export function renderEmail(template: EmailTemplate, locale: Locale, input: Params): RenderedEmail {
  const def = TEMPLATES[locale][template];
  const missing = def.required.filter((k) => !input[k]);
  if (missing.length > 0)
    throw new TemplateParamsError(`Missing params for ${template}: ${missing.join(', ')}`);
  const params: Params = {
    ...input,
    roleName: input.roleCode ? (ROLE_NAMES[locale][input.roleCode] ?? input.roleCode) : '',
  };
  const url = def.action ? params[def.action.param] : undefined;
  if (url && !/^https?:\/\//.test(url)) throw new TemplateParamsError(`Unsafe link in ${template}`);
  const textLines = def.lines.map((l) => fill(l, params, false, locale));
  const htmlLines = def.lines.map((l) => `<p>${fill(l, params, true, locale)}</p>`);
  if (def.action && url) {
    textLines.push('', `${def.action.label}: ${url}`);
    htmlLines.push(
      `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(def.action.label)}</a></p>`,
    );
  }
  const footer =
    locale === 'ru'
      ? 'Письмо отправлено автоматически, отвечать на него не нужно.'
      : 'This is an automated message, please do not reply.';
  textLines.push('', '—', footer);
  htmlLines.push(`<hr><p style="color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>`);
  return {
    subject: fill(def.subject, params, false, locale),
    text: textLines.join('\n'),
    html: `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;line-height:1.5">${htmlLines.join('')}</body></html>`,
  };
}
