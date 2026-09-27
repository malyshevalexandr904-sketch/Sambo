// Участники жеребьёвки категории: одобренные участия с допуском ADMITTED (ARCHITECTURE.md, 14.5, шаг 1).
// Команда — организация представительства, иначе клуб из снимка участия, иначе организация заявки; регион —
// представительства или из снимка. Контекст категории: правила турнира (формат, длительности) и счётчики.
import { Injectable } from '@nestjs/common';
import {
  type CompetitionFormatCode,
  formatForCount,
  type NamedRef,
  RuleSetParametersV1,
  type EntryStatus,
} from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import { z } from 'zod';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { type MatchDurations, matchDurationSeconds, youngestAge } from '../../brackets';
import type { CategoryRow } from '../../categories';
import {
  canonicalDrawInput,
  type DrawInput,
  type DrawParticipant,
  SEPARATION_KEYS,
} from '../domain/draw-input';

const PARTICIPANT_SELECT = {
  id: true,
  status: true,
  publicName: true,
  snapBirthDate: true,
  snapClubId: true,
  snapClubName: true,
  snapRegionId: true,
  snapRegionName: true,
  representationOrg: { select: { id: true, name: true, shortName: true } },
  representationRegion: { select: { id: true, nameRu: true } },
  application: { select: { organization: { select: { id: true, name: true, shortName: true } } } },
  admission: { select: { status: true } },
} satisfies Prisma.EntrySelect;

type ParticipantRow = Prisma.EntryGetPayload<{ select: typeof PARTICIPANT_SELECT }>;

export interface ParticipantInfo {
  entryId: string;
  entryStatus: EntryStatus;
  admitted: boolean;
  publicName: string;
  birthYear: number;
  organization: NamedRef | null;
  region: NamedRef | null;
}

export interface CategoryContext {
  category: CategoryRow;
  admitted: ParticipantInfo[];
  admissionPending: number;
  suggestedFormat: CompetitionFormatCode | null;
  durations: MatchDurations;
}

/** Сохранённый вход жеребьёвки (Draw.input) — проверка формы при чтении из jsonb. */
export const StoredDrawInput = z.object({
  algorithmVersion: z.string(),
  format: z.string(),
  separation: z.array(z.enum(SEPARATION_KEYS)),
  participants: z.array(
    z.object({
      entryId: z.string(),
      organizationKey: z.string().nullable(),
      regionKey: z.string().nullable(),
      seedNumber: z.number().int().nullable(),
    }),
  ),
});

export function parseStoredInput(value: unknown): DrawInput {
  const parsed = StoredDrawInput.parse(value);
  return { ...parsed, format: parsed.format as CompetitionFormatCode };
}

const named = (o: { id: string; name: string; shortName: string | null }): NamedRef => ({
  id: o.id,
  name: o.shortName || o.name,
});

function toInfo(e: ParticipantRow): ParticipantInfo {
  const organization: NamedRef = e.representationOrg
    ? named(e.representationOrg)
    : e.snapClubId
      ? { id: e.snapClubId, name: e.snapClubName ?? '' }
      : named(e.application.organization);
  const region: NamedRef | null = e.representationRegion
    ? { id: e.representationRegion.id, name: e.representationRegion.nameRu }
    : e.snapRegionId
      ? { id: e.snapRegionId, name: e.snapRegionName ?? '' }
      : null;
  return {
    entryId: e.id,
    entryStatus: e.status,
    admitted: e.status === 'APPROVED' && e.admission?.status === 'ADMITTED',
    publicName: e.publicName,
    birthYear: e.snapBirthDate.getUTCFullYear(),
    organization,
    region,
  };
}

export const toDrawParticipant = (p: ParticipantInfo, seedNumber: number | null): DrawParticipant => ({
  entryId: p.entryId,
  organizationKey: p.organization?.id ?? null,
  regionKey: p.region?.id ?? null,
  seedNumber,
});

@Injectable()
export class DrawParticipantsService {
  constructor(private readonly db: PrismaService) {}

  /** Сведения об участиях по идентификаторам (для слотов версии жеребьёвки). */
  async infos(tx: Tx | null, entryIds: string[]): Promise<Map<string, ParticipantInfo>> {
    if (entryIds.length === 0) return new Map();
    const rows = await (tx ?? this.db).entry.findMany({
      where: { id: { in: entryIds } },
      select: PARTICIPANT_SELECT,
    });
    return new Map(rows.map((r) => [r.id, toInfo(r)]));
  }

  async context(tx: Tx | null, category: CategoryRow): Promise<CategoryContext> {
    return (await this.contexts(tx, category.competitionId, [category]))[0] as CategoryContext;
  }

  /** Контексты нескольких категорий турнира: два запроса на все категории (обзор жеребьёвки). */
  async contexts(
    tx: Tx | null,
    competitionId: string,
    categories: CategoryRow[],
  ): Promise<CategoryContext[]> {
    const db = tx ?? this.db;
    const rows = await db.entry.findMany({
      where: { categoryId: { in: categories.map((c) => c.id) }, status: 'APPROVED' },
      select: { ...PARTICIPANT_SELECT, categoryId: true },
      orderBy: { id: 'asc' },
    });
    const competition = await db.competition.findUniqueOrThrow({
      where: { id: competitionId },
      select: { startDate: true, ruleSetVersion: { select: { parameters: true } } },
    });
    const params = RuleSetParametersV1.safeParse(competition.ruleSetVersion?.parameters ?? null);
    return categories.map((category) => {
      const own = rows.filter((r) => r.categoryId === category.id);
      const admitted = own.map(toInfo).filter((p) => p.admitted);
      const age = youngestAge({
        policy: category.agePolicy,
        ageFrom: category.ageFrom,
        birthYearTo: category.birthYearTo,
        referenceYear: (category.ageReferenceDate ?? competition.startDate).getUTCFullYear(),
      });
      return {
        category,
        admitted,
        admissionPending: own.filter((r) => !r.admission || r.admission.status === 'PENDING').length,
        suggestedFormat:
          category.formatOverride ??
          (params.success ? formatForCount(params.data.formatSelection, admitted.length) : null),
        durations: params.success
          ? {
              main: matchDurationSeconds(params.data, age, false),
              repechage: matchDurationSeconds(params.data, age, true),
            }
          : { main: null, repechage: null },
      };
    });
  }

  /** Вход, который дала бы жеребьёвка сейчас с параметрами версии: сравнение хеша показывает устаревший черновик. */
  currentInput(stored: DrawInput, ctx: CategoryContext): DrawInput {
    const seeds = new Map(stored.participants.map((p) => [p.entryId, p.seedNumber]));
    return canonicalDrawInput({
      format: stored.format,
      separation: stored.separation,
      algorithmVersion: stored.algorithmVersion,
      participants: ctx.admitted.map((p) => toDrawParticipant(p, seeds.get(p.entryId) ?? null)),
    });
  }
}
