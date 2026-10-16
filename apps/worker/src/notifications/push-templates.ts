// Тексты push-уведомлений (Phase 8b): заголовок и строка, видимые на экране блокировки. Без имён детей и причин
// (как в письмах; SECURITY.md, 3.7): турнир, категория, ковёр, номер и время схватки. Подробности — в приложении.
import type { Locale, NotificationType } from '@sde/contracts';
import type { NotificationSource } from '@sde/db';

type Texts = { title: string; body: (s: PushContext) => string };

export interface PushContext extends NotificationSource {
  /** Сколько схваток впереди («скоро»). */
  ahead?: string;
  locale: Locale;
}

const join = (...parts: (string | undefined | false)[]): string => parts.filter(Boolean).join(' · ');

function time(s: PushContext): string | undefined {
  if (!s.plannedAt) return undefined;
  try {
    return new Intl.DateTimeFormat(s.locale === 'en' ? 'en-GB' : 'ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: s.timezone ?? 'Europe/Moscow',
    }).format(new Date(s.plannedAt));
  } catch {
    return undefined;
  }
}

const ruPlural = (n: number, one: string, few: string, many: string): string => {
  const rule = new Intl.PluralRules('ru-RU').select(n);
  return rule === 'one' ? one : rule === 'few' ? few : many;
};

function aheadText(s: PushContext): string | undefined {
  if (s.ahead === undefined) return undefined;
  const n = Number(s.ahead);
  if (!Number.isFinite(n)) return undefined;
  if (s.locale === 'en') return n === 0 ? 'next up' : `in ${n} ${n === 1 ? 'bout' : 'bouts'}`;
  return n === 0 ? 'следующая' : `через ${n} ${ruPlural(n, 'схватку', 'схватки', 'схваток')}`;
}

const mat = (s: PushContext): string | undefined =>
  s.matNumber ? (s.locale === 'en' ? `Mat ${s.matNumber}` : `Ковёр ${s.matNumber}`) : undefined;
const bout = (s: PushContext): string | undefined =>
  s.matchNumber ? (s.locale === 'en' ? `bout № ${s.matchNumber}` : `схватка № ${s.matchNumber}`) : undefined;

const TEXTS: Record<Locale, Record<NotificationType, Texts>> = {
  ru: {
    'application.returned': {
      title: 'Заявка возвращена на исправление',
      body: (s) => join(s.competitionName),
    },
    'application.decided': { title: 'Решение по заявке', body: (s) => join(s.competitionName) },
    'entry.rejected': { title: 'Участие в заявке отклонено', body: (s) => join(s.competitionName) },
    'document.rejected': { title: 'Документ отклонён', body: (s) => join(s.documentType) },
    'schedule.changed': { title: 'Расписание турнира изменилось', body: (s) => join(s.competitionName) },
    'results.published': {
      title: 'Опубликованы результаты',
      body: (s) => join(s.categoryName, s.competitionName),
    },
    'match.soon': {
      title: 'Скоро схватка',
      body: (s) => join(mat(s), aheadText(s), bout(s), s.competitionName),
    },
    'match.started': { title: 'Схватка началась', body: (s) => join(mat(s), bout(s), s.competitionName) },
    'match.time_changed': {
      title: 'Изменилось время схватки',
      body: (s) => join(mat(s), time(s) && `около ${time(s)}`, bout(s), s.competitionName),
    },
    'onboarding.submitted': { title: 'Заявка на регистрацию отправлена', body: () => 'Ожидайте проверки' },
    'onboarding.forwarded': {
      title: 'Заявка передана на проверку организации',
      body: (s) => join(s.organizationName),
    },
    'onboarding.awaiting_review': { title: 'Новая заявка ждёт проверки', body: () => 'SAMBO Digital' },
    'onboarding.changes_requested': {
      title: 'Нужно исправить заявку',
      body: () => 'Подробности — в приложении',
    },
    'onboarding.decided': {
      title: 'Решение по заявке на регистрацию',
      body: (s) => (s.status === 'APPROVED' ? 'Заявка одобрена' : 'Заявка отклонена'),
    },
    'onboarding.linked': { title: 'В организации новый участник', body: (s) => join(s.organizationName) },
  },
  en: {
    'application.returned': {
      title: 'Application returned for correction',
      body: (s) => join(s.competitionName),
    },
    'application.decided': { title: 'Application decided', body: (s) => join(s.competitionName) },
    'entry.rejected': { title: 'Entry rejected', body: (s) => join(s.competitionName) },
    'document.rejected': { title: 'Document rejected', body: (s) => join(s.documentType) },
    'schedule.changed': { title: 'Tournament schedule changed', body: (s) => join(s.competitionName) },
    'results.published': { title: 'Results published', body: (s) => join(s.categoryName, s.competitionName) },
    'match.soon': {
      title: 'Bout coming up',
      body: (s) => join(mat(s), aheadText(s), bout(s), s.competitionName),
    },
    'match.started': { title: 'Bout started', body: (s) => join(mat(s), bout(s), s.competitionName) },
    'match.time_changed': {
      title: 'Bout time changed',
      body: (s) => join(mat(s), time(s) && `about ${time(s)}`, bout(s), s.competitionName),
    },
    'onboarding.submitted': { title: 'Registration request submitted', body: () => 'Awaiting review' },
    'onboarding.forwarded': {
      title: 'Request forwarded to the organization',
      body: (s) => join(s.organizationName),
    },
    'onboarding.awaiting_review': { title: 'A new request awaits review', body: () => 'SAMBO Digital' },
    'onboarding.changes_requested': {
      title: 'Please correct your request',
      body: () => 'Details are in the app',
    },
    'onboarding.decided': {
      title: 'Registration request decided',
      body: (s) => (s.status === 'APPROVED' ? 'Request approved' : 'Request rejected'),
    },
    'onboarding.linked': {
      title: 'A new member in your organization',
      body: (s) => join(s.organizationName),
    },
  },
};

/** Заголовок и строка push; имя спортсмена в контексте есть, но в текст не попадает. */
export function renderPush(type: NotificationType, ctx: PushContext): { title: string; body: string } {
  const t = TEXTS[ctx.locale][type];
  return { title: t.title, body: t.body(ctx) };
}
