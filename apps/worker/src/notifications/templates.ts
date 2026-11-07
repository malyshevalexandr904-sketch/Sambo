// Письма уведомлений по локалям (DATABASE.md, 3.8). В письмах нет ПДн детей (SECURITY.md, 3.7): имя спортсмена
// и место показываются только в приложении, куда пользователь входит с проверкой прав.
import { isMatchDayNotification, type Locale, type NotificationType } from '@sde/contracts';
import { type RenderedEmail, renderDefinition, type TemplateDef } from '../email/templates';
import { renderPush, STAFF_ROLE_NAMES } from './push-templates';

/** Письмо о схватке (Phase 8b): та же строка, что в push, — ковёр, номер, время, турнир; без имён. */
const matchDay = (subject: string, more: string, action: string): TemplateDef => ({
  subject: `${subject} — Цифровое самбо`,
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
    subject: 'Заявка на регистрацию отправлена — Цифровое самбо',
    lines: [
      'Ваша заявка на регистрацию (роль: {roleText}) отправлена и ожидает проверки командой платформы.',
      'О решении мы сообщим отдельно.',
    ],
    action: { label: 'Открыть заявку', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.forwarded': {
    subject: 'Заявка передана на проверку организации — Цифровое самбо',
    lines: [
      'Ваша заявка (роль: {roleText}) передана на проверку организации «{organizationName}».',
      'О решении мы сообщим отдельно.',
    ],
    action: { label: 'Открыть заявку', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
  'onboarding.awaiting_review': {
    subject: 'Новая заявка ждёт проверки — Цифровое самбо',
    lines: [
      'Поступила заявка на регистрацию (роль: {roleText}).',
      'Откройте её, чтобы одобрить, отклонить или запросить исправления.',
    ],
    action: { label: 'Открыть заявку', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.changes_requested': {
    subject: 'Нужно исправить заявку — Цифровое самбо',
    lines: [
      'Проверяющий просит исправить вашу заявку на регистрацию (роль: {roleText}).',
      'Комментарий: {reason}',
      'Исправьте данные и отправьте заявку снова — заполнять её заново не нужно.',
    ],
    action: { label: 'Исправить заявку', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.decided': {
    subject: 'Заявка на регистрацию {statusText} — Цифровое самбо',
    lines: ['Ваша заявка на регистрацию (роль: {roleText}) {statusText}.', 'Комментарий: {reason}'],
    action: { label: 'Открыть личный кабинет', param: 'url' },
    required: ['roleText', 'statusText', 'url'],
  },
  'onboarding.linked': {
    subject: 'В организации новый участник — Цифровое самбо',
    lines: ['Заявка (роль: {roleText}) одобрена: участник присоединён к организации «{organizationName}».'],
    action: { label: 'Открыть', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
};

const ONBOARDING_EN: typeof ONBOARDING_RU = {
  'onboarding.submitted': {
    subject: 'Registration request submitted — Цифровое самбо',
    lines: [
      'Your registration request (role: {roleText}) has been submitted and awaits review by the platform team.',
      'We will let you know about the decision.',
    ],
    action: { label: 'Open request', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.forwarded': {
    subject: 'Request forwarded to the organization — Цифровое самбо',
    lines: [
      'Your request (role: {roleText}) has been forwarded to “{organizationName}” for review.',
      'We will let you know about the decision.',
    ],
    action: { label: 'Open request', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
  'onboarding.awaiting_review': {
    subject: 'A new request awaits review — Цифровое самбо',
    lines: [
      'A new registration request (role: {roleText}) has arrived.',
      'Open it to approve, reject or request changes.',
    ],
    action: { label: 'Open request', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.changes_requested': {
    subject: 'Please correct your request — Цифровое самбо',
    lines: [
      'The reviewer asks you to correct your registration request (role: {roleText}).',
      'Comment: {reason}',
      'Correct the data and submit the request again — no need to fill it in from scratch.',
    ],
    action: { label: 'Correct request', param: 'url' },
    required: ['roleText', 'url'],
  },
  'onboarding.decided': {
    subject: 'Registration request {statusText} — Цифровое самбо',
    lines: ['Your registration request (role: {roleText}) has been {statusText}.', 'Comment: {reason}'],
    action: { label: 'Open your account', param: 'url' },
    required: ['roleText', 'statusText', 'url'],
  },
  'onboarding.linked': {
    subject: 'A new member in your organization — Цифровое самбо',
    lines: ['A request (role: {roleText}) has been approved: the member joined “{organizationName}”.'],
    action: { label: 'Open', param: 'url' },
    required: ['roleText', 'organizationName', 'url'],
  },
};

const TEMPLATES: Record<Locale, Record<NotificationType, TemplateDef>> = {
  ru: {
    'application.returned': {
      subject: 'Заявка возвращена на исправление — Цифровое самбо',
      lines: [
        'Заявка {organizationName} на турнир «{competitionName}» возвращена на исправление.',
        'Комментарий секретариата: {reason}',
        'Исправьте заявку и подайте её снова.',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'application.decided': {
      subject: 'Заявка {statusText} — Цифровое самбо',
      lines: [
        'Заявка {organizationName} на турнир «{competitionName}» {statusText}.',
        'Комментарий секретариата: {reason}',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'statusText', 'url'],
    },
    'entry.rejected': {
      subject: 'Участие отклонено — Цифровое самбо',
      lines: [
        'В заявке {organizationName} на турнир «{competitionName}» отклонено участие спортсмена.',
        'Причина: {reason}',
      ],
      action: { label: 'Открыть заявку', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'document.rejected': {
      subject: 'Документ отклонён — Цифровое самбо',
      lines: [
        'Загруженный вами документ «{documentType}» отклонён при проверке.',
        'Причина: {reason}',
        'Загрузите исправленный документ в разделе «Документы».',
      ],
      action: { label: 'Перейти к документам', param: 'url' },
      required: ['documentType', 'url'],
    },
    'document.expiring': {
      subject: 'Скоро истекает срок документа — Цифровое самбо',
      lines: [
        'Срок действия документа «{documentType}» истекает {expirationText}.',
        'Загрузите новый документ заранее, чтобы не остаться без допуска к соревнованиям.',
      ],
      action: { label: 'Открыть документы', param: 'url' },
      required: ['documentType', 'expirationText', 'url'],
    },
    'document.expired': {
      subject: 'Истёк срок документа — Цифровое самбо',
      lines: [
        'Срок действия документа «{documentType}» истёк {expirationText}.',
        'Загрузите новый документ — без него не получится заявиться на соревнования.',
      ],
      action: { label: 'Загрузить документ', param: 'url' },
      required: ['documentType', 'expirationText', 'url'],
    },
    'schedule.changed': {
      subject: 'Расписание турнира изменилось — Цифровое самбо',
      lines: [
        'В расписании турнира «{competitionName}» изменилось время или ковёр у ваших спортсменов.',
        'Проверьте актуальное расписание в заявке.',
      ],
      action: { label: 'Открыть турнир', param: 'url' },
      required: ['competitionName', 'url'],
    },
    'results.published': {
      subject: 'Опубликованы результаты — Цифровое самбо',
      lines: [
        'Опубликованы результаты категории «{categoryName}» турнира «{competitionName}».',
        'Места и медали ваших спортсменов — в разделе «Результаты» карточки спортсмена.',
      ],
      action: { label: 'Посмотреть результаты', param: 'url' },
      required: ['competitionName', 'categoryName', 'url'],
    },
    'competition.staff_invited': {
      subject: 'Приглашение в персонал турнира — Цифровое самбо',
      lines: [
        'Вас пригласили в персонал турнира «{competitionName}» (роль: {roleName}).',
        'Принять приглашение или отказаться можно в личном кабинете, в разделе «Приглашения».',
      ],
      action: { label: 'Открыть приглашения', param: 'url' },
      required: ['competitionName', 'roleName', 'url'],
    },
    'competition.registration_opened': {
      subject: 'Открыта регистрация на турнир — Цифровое самбо',
      lines: [
        'Открыта регистрация на турнир «{competitionName}».',
        'Тренеры и руководители спортивных организаций могут подавать заявки на своих спортсменов.',
      ],
      action: { label: 'Открыть турнир', param: 'url' },
      required: ['competitionName', 'url'],
    },
    'match.soon': matchDay('Скоро схватка', 'Подробности — в приложении.', 'Открыть'),
    'match.started': matchDay('Схватка началась', 'Подробности — в приложении.', 'Открыть'),
    'match.time_changed': matchDay('Изменилось время схватки', 'Подробности — в приложении.', 'Открыть'),
    ...ONBOARDING_RU,
  },
  en: {
    'application.returned': {
      subject: 'Application returned for correction — Цифровое самбо',
      lines: [
        'The application of {organizationName} for “{competitionName}” has been returned for correction.',
        'Secretariat comment: {reason}',
        'Please correct the application and submit it again.',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'application.decided': {
      subject: 'Application {statusText} — Цифровое самбо',
      lines: [
        'The application of {organizationName} for “{competitionName}” has been {statusText}.',
        'Secretariat comment: {reason}',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'statusText', 'url'],
    },
    'entry.rejected': {
      subject: 'Entry rejected — Цифровое самбо',
      lines: [
        'An athlete entry in the application of {organizationName} for “{competitionName}” has been rejected.',
        'Reason: {reason}',
      ],
      action: { label: 'Open application', param: 'url' },
      required: ['competitionName', 'organizationName', 'url'],
    },
    'document.rejected': {
      subject: 'Document rejected — Цифровое самбо',
      lines: [
        'The document “{documentType}” you uploaded was rejected during review.',
        'Reason: {reason}',
        'Please upload a corrected document in the Documents section.',
      ],
      action: { label: 'Open documents', param: 'url' },
      required: ['documentType', 'url'],
    },
    'document.expiring': {
      subject: 'A document is about to expire — Цифровое самбо',
      lines: [
        'The document “{documentType}” expires on {expirationText}.',
        'Upload a new one in advance so that you stay eligible for competitions.',
      ],
      action: { label: 'Open documents', param: 'url' },
      required: ['documentType', 'expirationText', 'url'],
    },
    'document.expired': {
      subject: 'A document has expired — Цифровое самбо',
      lines: [
        'The document “{documentType}” expired on {expirationText}.',
        'Upload a new one: you cannot be entered into competitions without it.',
      ],
      action: { label: 'Upload document', param: 'url' },
      required: ['documentType', 'expirationText', 'url'],
    },
    'schedule.changed': {
      subject: 'Tournament schedule changed — Цифровое самбо',
      lines: [
        'The schedule of “{competitionName}” has changed: mat or time for your athletes has been updated.',
        'Check the current schedule in your application.',
      ],
      action: { label: 'Open tournament', param: 'url' },
      required: ['competitionName', 'url'],
    },
    'results.published': {
      subject: 'Results published — Цифровое самбо',
      lines: [
        'Results of the category “{categoryName}” at “{competitionName}” have been published.',
        'Places and medals of your athletes are in the Results section of the athlete card.',
      ],
      action: { label: 'View results', param: 'url' },
      required: ['competitionName', 'categoryName', 'url'],
    },
    'competition.staff_invited': {
      subject: 'Invitation to the tournament staff — Цифровое самбо',
      lines: [
        'You have been invited to the staff of “{competitionName}” (role: {roleName}).',
        'Accept or decline the invitation in your account, under “Invitations”.',
      ],
      action: { label: 'Open invitations', param: 'url' },
      required: ['competitionName', 'roleName', 'url'],
    },
    'competition.registration_opened': {
      subject: 'Tournament registration is open — Цифровое самбо',
      lines: [
        'Registration for “{competitionName}” is open.',
        'Coaches and heads of sports organizations can now enter their athletes.',
      ],
      action: { label: 'Open tournament', param: 'url' },
      required: ['competitionName', 'url'],
    },
    'match.soon': matchDay('Bout coming up', 'Details are in the app.', 'Open'),
    'match.started': matchDay('Bout started', 'Details are in the app.', 'Open'),
    'match.time_changed': matchDay('Bout time changed', 'Details are in the app.', 'Open'),
    ...ONBOARDING_EN,
  },
};

/** Дата YYYY-MM-DD → ДД.ММ.ГГГГ (в письмах обеих локалей). */
const formatIsoDate = (d: string): string => {
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}.${m}.${y}` : d;
};

export function renderNotificationEmail(
  type: NotificationType,
  locale: Locale,
  params: Record<string, string>,
): RenderedEmail {
  const statusText = params.status ? (STATUS[locale][params.status] ?? params.status) : '';
  const details = isMatchDayNotification(type) ? renderPush(type, { ...params, locale }).body : '';
  const roleText = params.onboardingRole ? (ONBOARDING_ROLE[locale][params.onboardingRole] ?? '') : '';
  const expirationText = params.expirationDate ? formatIsoDate(params.expirationDate) : '';
  const roleName = params.roleCode ? (STAFF_ROLE_NAMES[locale][params.roleCode] ?? params.roleCode) : '';
  return renderDefinition(TEMPLATES[locale][type], `notification:${type}`, locale, {
    ...params,
    statusText,
    details,
    roleText,
    expirationText,
    roleName,
  });
}
