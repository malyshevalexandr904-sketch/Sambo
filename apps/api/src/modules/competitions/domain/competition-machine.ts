// Машина состояний турнира (ARCHITECTURE.md, 16.1). Таблица переходов с правом и обязательной причиной;
// условия, зависящие от других модулей (категории, заявки, жеребьёвка), регистрируют сами модули.
import { type CompetitionStatus, localDateIn, type PermissionCode, scheduleIssues } from '@sde/contracts';

export interface CompetitionTransition {
  from: CompetitionStatus;
  to: CompetitionStatus;
  permission: PermissionCode;
  reasonRequired: boolean;
}

const t = (
  from: CompetitionStatus,
  to: CompetitionStatus,
  permission: PermissionCode = 'competition.transition',
  reasonRequired = false,
): CompetitionTransition => ({ from, to, permission, reasonRequired });

const CANCELLABLE: CompetitionStatus[] = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CHECK_IN',
  'DRAWING',
  'SCHEDULED',
  'IN_PROGRESS',
];

export const COMPETITION_TRANSITIONS: readonly CompetitionTransition[] = [
  t('DRAFT', 'REGISTRATION_OPEN', 'competition.publish'),
  t('REGISTRATION_OPEN', 'REGISTRATION_CLOSED'),
  t('REGISTRATION_CLOSED', 'REGISTRATION_OPEN', 'competition.transition', true),
  t('REGISTRATION_CLOSED', 'CHECK_IN'),
  t('CHECK_IN', 'DRAWING'),
  t('DRAWING', 'CHECK_IN', 'competition.transition', true),
  t('DRAWING', 'SCHEDULED'),
  t('SCHEDULED', 'IN_PROGRESS'),
  t('IN_PROGRESS', 'FINISHED'),
  t('FINISHED', 'ARCHIVED'),
  ...CANCELLABLE.map((from) => t(from, 'CANCELLED', 'competition.transition', true)),
];

export function findTransition(from: CompetitionStatus, to: CompetitionStatus): CompetitionTransition | null {
  return COMPETITION_TRANSITIONS.find((x) => x.from === from && x.to === to) ?? null;
}

export function transitionsFrom(from: CompetitionStatus): CompetitionTransition[] {
  return COMPETITION_TRANSITIONS.filter((x) => x.from === from);
}

/** После публикации турнир не меняет дисциплину и правила; черновик и отменённый черновик — меняет. */
export const isPublished = (status: CompetitionStatus): boolean =>
  status !== 'DRAFT' && !(status === 'CANCELLED');

/** Операционные данные (категории, участия) меняются до начала турнира. */
export const isBeforeCompetition = (status: CompetitionStatus): boolean =>
  status === 'DRAFT' || status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED';

export interface ScheduleFacts {
  timezone: string;
  startDate: string;
  endDate: string;
  registrationStartsAt: string;
  registrationEndsAt: string;
}

export interface PublishFacts extends ScheduleFacts {
  ruleSetVersionStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED' | null;
  ruleSetDisciplineMatches: boolean;
}

/**
 * Собственные условия публикации (DRAFT → REGISTRATION_OPEN): закреплена опубликованная версия правил
 * дисциплины турнира, сроки согласованы и регистрация ещё не закончилась. Число категорий проверяет модуль
 * категорий. Отсутствие версии правил — отдельная ошибка RULESET_REQUIRED.
 */
export function publishIssues(f: PublishFacts, now: Date): string[] {
  const issues: string[] = [];
  if (f.ruleSetVersionStatus !== null && f.ruleSetVersionStatus !== 'PUBLISHED')
    issues.push('ruleset_not_published');
  if (f.ruleSetVersionStatus !== null && !f.ruleSetDisciplineMatches)
    issues.push('ruleset_discipline_mismatch');
  issues.push(...scheduleIssues(f).map((i) => i.code));
  if (Date.parse(f.registrationEndsAt) <= now.getTime()) issues.push('registration_ends_in_past');
  return issues;
}

/** Продление регистрации: новый срок в будущем и не позже даты начала турнира в его часовом поясе. */
export function reopenIssues(
  f: Pick<ScheduleFacts, 'timezone' | 'startDate'>,
  newEndsAt: string | undefined,
  now: Date,
): string[] {
  if (!newEndsAt) return ['registration_ends_at_required'];
  const issues: string[] = [];
  if (Date.parse(newEndsAt) <= now.getTime()) issues.push('registration_ends_in_past');
  if (localDateIn(newEndsAt, f.timezone) > f.startDate) issues.push('registration_after_start');
  return issues;
}

export type RegistrationWindow = 'NOT_OPEN' | 'OPEN' | 'CLOSED';

/**
 * Окно регистрации (DATABASE.md, 4): заявки принимаются, пока турнир в REGISTRATION_OPEN и момент — в окне
 * `[registrationStartsAt, registrationEndsAt)`. Сравниваются моменты UTC, поэтому часовой пояс не нужен.
 */
export function registrationWindow(
  c: { status: CompetitionStatus; registrationStartsAt: Date; registrationEndsAt: Date },
  now: Date,
): RegistrationWindow {
  if (c.status === 'DRAFT') return 'NOT_OPEN';
  if (c.status !== 'REGISTRATION_OPEN') return 'CLOSED';
  if (now < c.registrationStartsAt) return 'NOT_OPEN';
  if (now >= c.registrationEndsAt) return 'CLOSED';
  return 'OPEN';
}

/** Возвращённую заявку можно подать повторно до начала мандатной комиссии, даже после окончания регистрации. */
export const resubmissionAllowed = (status: CompetitionStatus): boolean =>
  status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED';
