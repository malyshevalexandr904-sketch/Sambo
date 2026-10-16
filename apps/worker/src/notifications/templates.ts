// Письма уведомлений по локалям (DATABASE.md, 3.8). В письмах нет ПДн детей (SECURITY.md, 3.7): имя спортсмена
// и место показываются только в приложении, куда пользователь входит с проверкой прав.
import { isMatchDayNotification, type Locale, type NotificationType } from '@sde/contracts';
import { type RenderedEmail, renderDefinition, type TemplateDef } from '../email/templates';
import { renderPush } from './push-templates';

/** Письмо о схватке (Phase 8b): та же строка, что в push, — ковёр, номер, время, турнир; без имён. */
const matchDay = (subject: string, more: string, action: string): TemplateDef => ({
  subject: `${subject} — SAMBO Digital`,
  lines: ['{details}.', more],
  action: { label: action, param: 'url' },
  required: ['details', 'url'],
});

const STATUS: Record<Locale, Record<string, string>> = {
  ru: { APPROVED: 'одобрена', REJECTED: 'отклонена' },
  en: { APPROVED: 'approved', REJECTED: 'rejected' },
};

/** Роль заявки на регистрацию (Phase 9a) — в тексте письма. */
const ONBOARDING_ROLE: Record<Locale, Record<string, string>> = {
  ru: {
    ORGANIZATION_HEAD: 'руководитель спортивной организации',
    COACH: 'тренер',
    ATHLETE: 'спортсмен',
    REFEREE: 'судья',
  },
  en: {
    ORGANIZATION_HEAD: 'head of a sports organization',
    COACH: 'coach',
    ATHLETE: 'athlete',
    REFEREE: 'referee',
  },
};

/** Письма о заявках на регистрацию: без ФИО заявителя (SECURITY.md, 3.7) — подробности в приложении. */
const ONBOARDING_RU: Record<
  | 'onboarding.submitted'
  | 'onboarding.forwarded'
  | 'onboarding.awaiting_review'
  | 'onboarding.changes_requested'
  | 'onboarding.decided'
  | 'onboarding.linked',
  TemplateDef
> = {
  'onboarding.submitted': {
    subject: 'Заявка на регистрацию отправлена — SAMBO Digital',
    lines: [
      'Ваша заявка на регистрацию (роль: {roleText}) отправлена и ожидает проверки командой платформы.',
      'О решении мы сообщим отдельно.',
    ],
    action: { label: 'Открыть заявку', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.forwarded': {
    subject: 'Заявка передана на проверку организации — SAMBO Digital',
    lines: [
      'Ваша заявка (роль: {roleText}) передана на проверку организации «{organizationName}».',
      'О решении мы сообщим отдельно.',
    ],
    action: { label: 'Открыть заявку', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
  'onboarding.awaiting_review': {
    subject: 'Новая заявка ждёт проверки — SAMBO Digital',
    lines: [
      'Поступила заявка на регистрацию (роль: {roleText}).',
      'Откройте её, чтобы одобрить, отклонить или запросить исправления.',
    ],
    action: { label: 'Открыть заявку', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.changes_requested': {
    subject: 'Нужно исправить заявку — SAMBO Digital',
    lines: [
      'Проверяющий просит исправить вашу заявку на регистрацию (роль: {roleText}).',
      'Комментарий: {reason}',
      'Исправьте данные и отправьте заявку снова — заполнять её заново не нужно.',
    ],
    action: { label: 'Исправить заявку', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.decided': {
    subject: 'Заявка на регистрацию {statusText} — SAMBO Digital',
    lines: ['Ваша заявка на регистрацию (роль: {roleText}) {statusText}.', 'Комментарий: {reason}'],
    action: { label: 'Открыть личный кабинет', param: 'url' },
    required: ['roleText', 'statusText', 'url'],
  },
  'onboarding.linked': {
    subject: 'В организации новый участник — SAMBO Digital',
    lines: ['Заявка (роль: {roleText}) одобрена: участник присоединён к организации «{organizationName}».'],
    action: { label: 'Открыть', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
};

const ONBOARDING_EN: typeof ONBOARDING_RU = {
  'onboarding.submitted': {
    subject: 'Registration request submitted — SAMBO Digital',
    lines: [
      'Your registration request (role: {roleText}) has been submitted and awaits review by the platform team.',
      'We will let you know about the decision.',
    ],
    action: { label: 'Open request', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.forwarded': {
    subject: 'Request forwarded to the organization — SAMBO Digital',
    lines: [
      'Your request (role: {roleText}) has been forwarded to “{organizationName}” for review.',
      'We will let you know about the decision.',
    ],
    action: { label: 'Open request', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
  'onboarding.awaiting_review': {
    subject: 'A new request awaits review — SAMBO Digital',
    lines: [
      'A new registration request (role: {roleText}) has arrived.',
      'Open it to approve, reject or request changes.',
    ],
    action: { label: 'Open request', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.changes_requested': {
    subject: 'Please correct your request — SAMBO Digital',
    lines: [
      'The reviewer asks you to correct your registration request (role: {roleText}).',
      'Comment: {reason}',
      'Correct the data and submit the request again — no need to fill it in from scratch.',
    ],
    action: { label: 'Correct request', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.decided': {
    subject: 'Registration request {statusText} — SAMBO Digital',
    lines: ['Your registration request (role: {roleText}) has been {statusText}.', 'Comment: {reason}'],
    action: { label: 'Open your account', param: 'url' },
    required: ['roleText', 'statusText', 'url'],
  },
  'onboarding.linked': {
    subject: 'A new member in your organization — SAMBO Digital',
    lines: ['A request (role: {roleText}) has been approved: the member joined “{organizationName}”.'],
    action: { label: 'Open', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
};

const TEMPLATES: Record<Locale, Record<NotificationType, TemplateDef>> = {
  ru: {
    'application.returned': {
      subject: 'Заявка возвращена на исправление — SAMBO Digital',
      lines: [
        'Заявка {organizationName} на турнир «{competitionName}» возвращена на исправление.',
        'Комментарий секретариата: {reason}',
        'Исправьте заявку и подайте её снова.',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'application.decided': {
      subject: 'Заявка {statusText} — SAMBO Digital',
      lines: [
        'Заявка {organizationName} на турнир «{competitionName}» {statusText}.',
        'Комментарий секретариата: {reason}',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'statusText', 'url'],
    },
    'entry.rejected': {
      subject: 'Участие отклонено — SAMBO Digital',
      lines: [
        'В заявке {organizationName} на турнир «{competitionName}» отклонено участие спортсмена.',
        'Причина: {reason}',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'document.rejected': {
      subject: 'Документ отклонён — SAMBO Digital',
      lines: [
        'Загруженный вами документ «{documentType}» отклонён при проверке.',
        'Причина: {reason}',
        'Загрузите исправленный документ в разделе «Документы».',
      ],
      action: { label: 'Перейти к документам', param: 'url' },
      required: ['documentType', 'url'],
    },
    'schedule.changed': {
      subject: 'Расписание турнира изменилось — SAMBO Digital',
      lines: [
        'В расписании турнира «{competitionName}» изменилось время или ковёр у ваших спортсменов.',
        'Проверьте актуальное расписание в заявке.',
      ],
      action: { label: 'Открыть турнир', param: 'url' },
      required: ['competitionName', 'url'],
    },
    'results.published': {
      subject: 'Опубликованы результаты — SAMBO Digital',
      lines: [
        'Опубликованы результаты категории «{categoryName}» турнира «{competitionName}».',
        'Места и медали ваших спортсменов — в разделе «Результаты» карточки спортсмена.',
      ],
      action: { label: 'Посмотреть результаты', param: 'url' },
      required: ['competitionName', 'categoryName', 'url'],
    },
    'match.soon': matchDay('Скоро схватка', 'Подробности — в приложении.', 'Открыть'),
    'match.started': matchDay('Схватка началась', 'Подробности — в приложении.', 'Открыть'),
    'match.time_changed': matchDay('Изменилось время схватки', 'Подробности — в приложении.', 'Открыть'),
    ...ONBOARDING_RU,
  },
  en: {
    'application.returned': {
      subject: 'Application returned for correction — SAMBO Digital',
      lines: [
        'The application of {organizationName} for “{competitionName}” has been returned for correction.',
        'Secretariat comment: {reason}',
        'Please correct the application and submit it again.',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'application.decided': {
      subject: 'Application {statusText} — SAMBO Digital',
      lines: [
        'The application of {organizationName} for “{competitionName}” has been {statusText}.',
        'Secretariat comment: {reason}',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'statusText', 'url'],
    },
    'entry.rejected': {
      subject: 'Entry rejected — SAMBO Digital',
      lines: [
        'An athlete entry in the application of {organizationName} for “{competitionName}” has been rejected.',
        'Reason: {reason}',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'document.rejected': {
      subject: 'Document rejected — SAMBO Digital',
      lines: [
        'The document “{documentType}” you uploaded was rejected during review.',
        'Reason: {reason}',
        'Please upload a corrected document in the Documents section.',
      ],
      action: { label: 'Open documents', param: 'url' },
      required: ['documentType', 'url'],
    },
    'schedule.changed': {
      subject: 'Tournament schedule changed — SAMBO Digital',
      lines: [
        'The schedule of “{competitionName}” has changed: mat or time for your athletes has been updated.',
        'Check the current schedule in your application.',
      ],
      action: { label: 'Open tournament', param: 'url' },
      required: ['competitionName', 'url'],
    },
    'results.published': {
      subject: 'Results published — SAMBO Digital',
      lines: [
        'Results of the category “{categoryName}” at “{competitionName}” have been published.',
        'Places and medals of your athletes are in the Results section of the athlete card.',
      ],
      action: { label: 'View results', param: 'url' },
      required: ['competitionName', 'categoryName', 'url'],
    },
    'match.soon': matchDay('Bout coming up', 'Details are in the app.', 'Open'),
    'match.started': matchDay('Bout started', 'Details are in the app.', 'Open'),
    'match.time_changed': matchDay('Bout time changed', 'Details are in the app.', 'Open'),
    ...ONBOARDING_EN,
  },
};

export function renderNotificationEmail(
  type: NotificationType,
  locale: Locale,
  params: Record<string, string>,
): RenderedEmail {
  const statusText = params.status ? (STATUS[locale][params.status] ?? params.status) : '';
  const details = isMatchDayNotification(type) ? renderPush(type, { ...params, locale }).body : '';
  const roleText = params.onboardingRole ? (ONBOARDING_ROLE[locale][params.onboardingRole] ?? '') : '';
  return renderDefinition(TEMPLATES[locale][type], `notification:${type}`, locale, {
    ...params,
    statusText,
    details,
    roleText,
  });
}
