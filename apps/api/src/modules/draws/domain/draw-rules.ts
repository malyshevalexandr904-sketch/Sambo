// Правила жеребьёвки (ARCHITECTURE.md, 16.1, 16.2, 16.5): когда можно создать черновик, опубликовать и заменить.
// Жеребьёвка — этап турнира DRAWING; на многодневном турнире категории тянут и позже (SCHEDULED, IN_PROGRESS).
import type { CategoryStatus, CompetitionStatus, DrawStatus } from '@sde/contracts';

export const DRAW_PHASE: readonly CompetitionStatus[] = ['DRAWING', 'SCHEDULED', 'IN_PROGRESS'];

export const inDrawPhase = (status: CompetitionStatus): boolean => DRAW_PHASE.includes(status);

/** Минимум участников жеребьёвки: с одним спортсменом категорию отменяют или объединяют. */
export const MIN_DRAW_PARTICIPANTS = 2;

export interface DrawActionContext {
  competitionStatus: CompetitionStatus;
  categoryStatus: CategoryStatus;
}

/**
 * Жеребьёвка — только по решённому допуску (ARCHITECTURE.md, 16.2): пока у кого-то из участников категории допуск
 * не решён (например, документ вернули на проверку после готовности категории), черновик не создаётся
 * и не публикуется — иначе спортсмен молча выпал бы из сетки.
 */
export interface DrawAdmission {
  admitted: number;
  admissionPending: number;
}

export function categoryDrawActions(
  ctx: DrawActionContext & DrawAdmission & { canCreate: boolean },
): string[] {
  const ok =
    ctx.canCreate &&
    inDrawPhase(ctx.competitionStatus) &&
    ctx.categoryStatus === 'READY_FOR_DRAW' &&
    ctx.admissionPending === 0 &&
    ctx.admitted >= MIN_DRAW_PARTICIPANTS;
  return ok ? ['draw.create'] : [];
}

export function drawActions(
  ctx: DrawActionContext & {
    status: DrawStatus;
    stale: boolean;
    /** Последняя версия категории: опубликовать можно только самый новый черновик. */
    latest: boolean;
    admissionPending: number;
    canPublish: boolean;
    canRepublish: boolean;
  },
): string[] {
  const actions = ['draw.verify'];
  if (!inDrawPhase(ctx.competitionStatus)) return actions;
  if (
    ctx.status === 'DRAFT' &&
    ctx.canPublish &&
    !ctx.stale &&
    ctx.latest &&
    ctx.admissionPending === 0 &&
    ctx.categoryStatus === 'READY_FOR_DRAW'
  )
    actions.push('draw.publish');
  if (ctx.status === 'PUBLISHED' && ctx.canRepublish && ctx.categoryStatus === 'DRAWN')
    actions.push('draw.supersede');
  return actions;
}
