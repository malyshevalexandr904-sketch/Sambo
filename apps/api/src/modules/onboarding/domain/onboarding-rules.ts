// Правила заявок на регистрацию (Phase 9a): переходы статусов по действию и роли того, кто действует; нормализация
// названия организации для поиска дублей. Чистые функции: без NestJS и Prisma.
import {
  onboardingReviewTarget,
  type OnboardingKind,
  type OnboardingRole,
  type OnboardingStatus,
} from '@sde/contracts';

export type OnboardingCommand = 'submit' | 'cancel' | 'approve' | 'reject' | 'request_changes';

/** Кто действует: заявитель или проверяющий — платформа (PENDING_REVIEW) либо организация (PENDING_ORGANIZATION_APPROVAL). */
export type OnboardingActor = 'APPLICANT' | 'PLATFORM' | 'ORGANIZATION';

interface Transition {
  command: OnboardingCommand;
  actor: OnboardingActor;
  from: readonly OnboardingStatus[];
  /** null — статус вычисляется (отправка: проверка платформой или организацией). */
  to: OnboardingStatus | null;
  reasonRequired: boolean;
}

const EDITABLE: readonly OnboardingStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];

export const ONBOARDING_TRANSITIONS: readonly Transition[] = [
  { command: 'submit', actor: 'APPLICANT', from: EDITABLE, to: null, reasonRequired: false },
  {
    command: 'cancel',
    actor: 'APPLICANT',
    from: ['DRAFT', 'PENDING_REVIEW', 'PENDING_ORGANIZATION_APPROVAL', 'CHANGES_REQUESTED'],
    to: 'CANCELLED',
    reasonRequired: false,
  },
  ...(['PLATFORM', 'ORGANIZATION'] as const).flatMap((actor) => {
    const from: OnboardingStatus[] = [
      actor === 'PLATFORM' ? 'PENDING_REVIEW' : 'PENDING_ORGANIZATION_APPROVAL',
    ];
    return [
      { command: 'approve' as const, actor, from, to: 'APPROVED' as const, reasonRequired: false },
      { command: 'reject' as const, actor, from, to: 'REJECTED' as const, reasonRequired: true },
      {
        command: 'request_changes' as const,
        actor,
        from,
        to: 'CHANGES_REQUESTED' as const,
        reasonRequired: true,
      },
    ];
  }),
];

interface TransitionAllowed {
  ok: true;
  to: OnboardingStatus;
  reasonRequired: boolean;
}
interface TransitionDenied {
  ok: false;
  allowed: OnboardingCommand[];
}
export type TransitionResult = TransitionAllowed | TransitionDenied;

/** Переход по команде. Статус после отправки — по сценарию: организации или платформе. */
export function onboardingTransition(
  request: {
    status: OnboardingStatus;
    role: OnboardingRole;
    kind: OnboardingKind;
    inOrganization: boolean | null;
  },
  command: OnboardingCommand,
  actor: OnboardingActor,
): TransitionResult {
  const t = ONBOARDING_TRANSITIONS.find(
    (x) => x.command === command && x.actor === actor && x.from.includes(request.status),
  );
  if (!t) {
    const allowed = ONBOARDING_TRANSITIONS.filter(
      (x) => x.actor === actor && x.from.includes(request.status),
    ).map((x) => x.command);
    return { ok: false, allowed };
  }
  const to =
    t.to ??
    (onboardingReviewTarget(request) === 'ORGANIZATION' ? 'PENDING_ORGANIZATION_APPROVAL' : 'PENDING_REVIEW');
  return { ok: true, to, reasonRequired: t.reasonRequired };
}

/** Заявку можно менять (поля, документы) только в черновике и после запроса исправлений. */
export const isEditable = (status: OnboardingStatus): boolean => EDITABLE.includes(status);

/** Какой проверяющий решает заявку в этом статусе. */
export function reviewerOf(status: OnboardingStatus): Exclude<OnboardingActor, 'APPLICANT'> | null {
  if (status === 'PENDING_REVIEW') return 'PLATFORM';
  if (status === 'PENDING_ORGANIZATION_APPROVAL') return 'ORGANIZATION';
  return null;
}

// Длинные формы — раньше коротких: в альтернативе побеждает первая совпавшая («ано до» прежде «ано»).
const LEGAL_PREFIXES =
  /^(ано до|мбу до|мау до|гбу до|мбоу|мкоу|фгбу|ооо|оао|зао|пао|ано|нко|мбу|мау|гбу|гау|гку|чоу|роо|ао|ип|ро|оо|llc|ltd|inc)\s+/u;

/**
 * Название организации для сравнения: регистр, «ё», кавычки, повторные пробелы и организационно-правовая форма в
 * начале не различают организации («ООО "Самбо-70"» = «самбо-70»).
 */
export function normalizeOrganizationName(name: string): string {
  let s = name
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[«»"'“”„`]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEGAL_PREFIXES, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}
