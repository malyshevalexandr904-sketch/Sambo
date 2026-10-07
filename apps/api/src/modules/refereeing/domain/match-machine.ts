// Машина состояний схватки (ARCHITECTURE.md, 16.6; план Phase 7a, §1): переходы по команде с правом каждого.
// Завершение — командой результата (POST …/result: предварительный результат и завершение вместе); переход
// FINISHED без результата — MATCH_RESULT_INCOMPLETE. Перенос и отмена (POSTPONED, CANCELLED) — Phase 7b.
import type { MatchStatus, MatchTransitionTarget, PermissionCode } from '@sde/contracts';

export interface MatchTransition {
  from: MatchStatus;
  to: MatchTransitionTarget;
  permission: PermissionCode;
}

const t = (from: MatchStatus, to: MatchTransitionTarget, permission: PermissionCode): MatchTransition => ({
  from,
  to,
  permission,
});

export const MATCH_TRANSITIONS: readonly MatchTransition[] = [
  // Вызов пары и его отмена.
  t('SCHEDULED', 'READY', 'match.update'),
  t('READY', 'SCHEDULED', 'match.update'),
  // Старт; продолжение после длинной остановки.
  t('READY', 'IN_PROGRESS', 'match.start'),
  t('PAUSED', 'IN_PROGRESS', 'match.start'),
  // Длинная остановка (врач, экипировка); короткие «стоп» судьи — остановки секундомера, а не пауза.
  t('IN_PROGRESS', 'PAUSED', 'match.update'),
  // Завершение требует предварительного результата (команда result).
  t('IN_PROGRESS', 'FINISHED', 'match.finish'),
  t('PAUSED', 'FINISHED', 'match.finish'),
];

export function findMatchTransition(from: MatchStatus, to: MatchTransitionTarget): MatchTransition | null {
  return MATCH_TRANSITIONS.find((x) => x.from === from && x.to === to) ?? null;
}

export function matchTransitionsFrom(from: MatchStatus): MatchTransition[] {
  return MATCH_TRANSITIONS.filter((x) => x.from === from);
}

/** Схватка идёт (на ковре): события журнала и результат — только в этих статусах. */
export const isLive = (status: MatchStatus): boolean => status === 'IN_PROGRESS' || status === 'PAUSED';

/** Неявка по вызову — до старта (схватка запланирована или вызвана). */
export const noShowAllowed = (status: MatchStatus): boolean => status === 'SCHEDULED' || status === 'READY';
