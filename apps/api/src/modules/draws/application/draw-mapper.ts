// Представления жеребьёвки: версия (кратко и полностью), категория, участники и отчёт о разведении с названиями.
import {
  type CategoryWeight,
  type DrawCategoryDto,
  type DrawParticipantDto,
  type DrawSlotDto,
  type DrawSummaryDto,
  type NamedRef,
  type SeparationReportDto,
  type UserRef,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';
import type { CategoryRow } from '../../categories';
import type { SeparationReport } from '../domain/separation';
import type { ParticipantInfo } from './draw-participants';

export const DRAW_SUMMARY_SELECT = {
  id: true,
  competitionId: true,
  categoryId: true,
  number: true,
  status: true,
  format: true,
  version: true,
  createdAt: true,
  publishedAt: true,
  supersededAt: true,
  _count: { select: { slots: { where: { entryId: { not: null } } } } },
} satisfies Prisma.DrawSelect;

export type DrawSummaryRow = Prisma.DrawGetPayload<{ select: typeof DRAW_SUMMARY_SELECT }>;

const USER_REF = { select: { id: true, displayName: true } } as const;

export const DRAW_FULL_INCLUDE = {
  slots: { orderBy: { position: 'asc' } },
  createdBy: USER_REF,
  publishedBy: USER_REF,
  supersededBy: USER_REF,
  _count: { select: { slots: { where: { entryId: { not: null } } } } },
} satisfies Prisma.DrawInclude;

export type DrawFullRow = Prisma.DrawGetPayload<{ include: typeof DRAW_FULL_INCLUDE }>;

export function toDrawSummary(row: DrawSummaryRow, stale: boolean, allowedActions: string[]): DrawSummaryDto {
  return {
    id: row.id,
    categoryId: row.categoryId,
    number: row.number,
    status: row.status,
    format: row.format,
    participants: row._count.slots,
    stale,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    version: row.version,
    allowedActions,
  };
}

export const toUserRef = (u: { id: string; displayName: string } | null): UserRef | null =>
  u ? { id: u.id, displayName: u.displayName } : null;

export function toDrawCategory(c: CategoryRow): DrawCategoryDto {
  const weight: CategoryWeight = {
    kind: c.weightKind,
    lowerGrams: c.weightLowerGrams,
    upperGrams: c.weightUpperGrams,
  };
  return {
    id: c.id,
    code: c.code,
    name: { ru: c.nameRu, en: c.nameEn },
    status: c.status,
    gender: c.gender,
    weight,
    formatOverride: c.formatOverride,
    sortOrder: c.sortOrder,
  };
}

export const toSlotDto = (s: {
  position: number;
  entryId: string | null;
  seedNumber: number | null;
  pool: string | null;
}): DrawSlotDto => ({
  position: s.position,
  entryId: s.entryId,
  seedNumber: s.seedNumber,
  pool: s.pool === 'A' || s.pool === 'B' ? s.pool : null,
});

/** Участники версии жеребьёвки в порядке позиций; данные — из снимка участия (ADR-10). */
export function toParticipants(
  slots: DrawSlotDto[],
  infos: ReadonlyMap<string, ParticipantInfo>,
): DrawParticipantDto[] {
  return slots
    .filter((s): s is DrawSlotDto & { entryId: string } => s.entryId !== null)
    .map((s) => {
      const info = infos.get(s.entryId);
      return {
        entryId: s.entryId,
        publicName: info?.publicName ?? '—',
        birthYear: info?.birthYear ?? 0,
        organization: info?.organization ?? null,
        region: info?.region ?? null,
        seedNumber: s.seedNumber,
        position: s.position,
        pool: s.pool,
        entryStatus: info?.entryStatus ?? 'APPROVED',
      };
    });
}

/** Отчёт о разведении с названиями групп (организации и регионы участников версии). */
export function toSeparationDto(
  report: unknown,
  infos: ReadonlyMap<string, ParticipantInfo>,
): SeparationReportDto {
  const r = report as SeparationReport;
  const names = new Map<string, string>();
  const remember = (ref: NamedRef | null): void => {
    if (ref) names.set(ref.id, ref.name);
  };
  for (const info of infos.values()) {
    remember(info.organization);
    remember(info.region);
  }
  return {
    applicable: r.applicable,
    keys: r.keys,
    unmet: r.unmet,
    groups: r.groups.map((g) => ({ ...g, name: names.get(g.value) ?? null })),
  };
}
