// Машина состояний категории турнира (ARCHITECTURE.md, 16.2; C-03). Часть переходов выполняет только система:
// жеребьёвка (Phase 5), схватки и итоги (Phase 7, 9), объединение — отдельной командой.
import type { CategoryStatus, CompetitionStatus } from '@sde/contracts';

export interface CategoryTransition {
  from: CategoryStatus;
  to: CategoryStatus;
  /** Переход доступен через API командой `transitions`; иначе его выполняет система или другая команда. */
  manual: boolean;
  reasonRequired: boolean;
  /** Статусы турнира, в которых переход допустим. */
  competition: readonly CompetitionStatus[];
}

const REGISTRATION_PHASE: CompetitionStatus[] = ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];
const OPERATIONS_PHASE: CompetitionStatus[] = ['CHECK_IN', 'DRAWING', 'SCHEDULED', 'IN_PROGRESS'];
const ANY_ACTIVE: CompetitionStatus[] = [...REGISTRATION_PHASE, ...OPERATIONS_PHASE];

const t = (
  from: CategoryStatus,
  to: CategoryStatus,
  manual: boolean,
  competition: readonly CompetitionStatus[],
  reasonRequired = false,
): CategoryTransition => ({ from, to, manual, reasonRequired, competition });

export const CATEGORY_TRANSITIONS: readonly CategoryTransition[] = [
  t('REGISTRATION', 'CLOSED', true, ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED']),
  t('CLOSED', 'REGISTRATION', true, ['REGISTRATION_OPEN'], true),
  t('CLOSED', 'WEIGH_IN', true, OPERATIONS_PHASE),
  t('CLOSED', 'READY_FOR_DRAW', true, OPERATIONS_PHASE),
  t('WEIGH_IN', 'READY_FOR_DRAW', true, OPERATIONS_PHASE),
  t('READY_FOR_DRAW', 'DRAWN', false, OPERATIONS_PHASE),
  t('DRAWN', 'READY_FOR_DRAW', false, OPERATIONS_PHASE),
  t('DRAWN', 'IN_PROGRESS', false, OPERATIONS_PHASE),
  t('IN_PROGRESS', 'COMPLETED', false, OPERATIONS_PHASE),
  t('COMPLETED', 'RESULTS_PUBLISHED', false, [...OPERATIONS_PHASE, 'FINISHED']),
  ...(['REGISTRATION', 'CLOSED', 'WEIGH_IN', 'READY_FOR_DRAW'] as const).flatMap((from) => [
    t(from, 'MERGED', false, ANY_ACTIVE),
    t(from, 'CANCELLED', true, ANY_ACTIVE, true),
  ]),
];

export const findCategoryTransition = (from: CategoryStatus, to: CategoryStatus): CategoryTransition | null =>
  CATEGORY_TRANSITIONS.find((x) => x.from === from && x.to === to) ?? null;

export const manualTransitionsFrom = (from: CategoryStatus): CategoryStatus[] =>
  CATEGORY_TRANSITIONS.filter((x) => x.from === from && x.manual).map((x) => x.to);

/** Категория, в которую ещё можно объединять и переводить участников: до жеребьёвки. */
export const MERGEABLE: readonly CategoryStatus[] = ['REGISTRATION', 'CLOSED', 'WEIGH_IN', 'READY_FOR_DRAW'];

/** Категория участвует в турнире (не объединена и не отменена). */
export const isActiveCategory = (status: CategoryStatus): boolean =>
  status !== 'MERGED' && status !== 'CANCELLED';

/** Статус новой категории по статусу турнира: в закрытой регистрации категория сразу закрыта. */
export const initialCategoryStatus = (competition: CompetitionStatus): CategoryStatus =>
  competition === 'REGISTRATION_CLOSED' ? 'CLOSED' : 'REGISTRATION';
