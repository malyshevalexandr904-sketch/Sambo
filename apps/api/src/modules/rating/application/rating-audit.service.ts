// Раздел «Рейтинг» кабинета администратора (docs/RATING_ARCHITECTURE.md, 8; фаза 14): сводка, журнал расчётов и
// поиск спортсмена для перехода к его рейтингу. Только чтение; права — `competition.view_rating_audit`.
import { Injectable } from '@nestjs/common';
import type {
  Page,
  RatingAthleteHit,
  RatingAthletesQuery,
  RatingCalculationEntry,
  RatingCalculationsQuery,
  RatingCalculationStatus,
  RatingDashboard,
  RatingStatus,
} from '@sde/contracts';
import { Prisma } from '@sde/db';
import { SAMBO_ELO_CODE, toRuleSetInfo } from '@sde/rating';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { correctionDto } from './rating-admin.service';

const RECENT_CORRECTIONS = 10;
const SEARCH_LIMIT = 20;

const fullName = (p: { lastName: string; firstName: string }): string => `${p.lastName} ${p.firstName}`;

@Injectable()
export class RatingAuditService {
  constructor(private readonly db: PrismaService) {}

  async dashboard(): Promise<RatingDashboard> {
    const [ruleSet, statuses, calculations, ratedCompetitions, last, corrections] = await Promise.all([
      this.db.ratingRuleSet.findFirst({ where: { code: SAMBO_ELO_CODE, status: 'ACTIVE' } }),
      this.db.athleteRating.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.ratingCalculation.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.competition.count({ where: { competitionType: 'RATED', deletedAt: null } }),
      this.db.ratingCalculation.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { processedAt: 'desc' },
        select: { processedAt: true },
      }),
      this.db.ratingCorrection.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_CORRECTIONS,
        include: { athlete: { select: { person: { select: { lastName: true, firstName: true } } } } },
      }),
    ]);
    const athletes = (s: RatingStatus) => statuses.find((x) => x.status === s)?._count._all ?? 0;
    const calcs = (s: RatingCalculationStatus) => calculations.find((x) => x.status === s)?._count._all ?? 0;
    return {
      calculationVersion: ruleSet ? toRuleSetInfo(ruleSet).calculationVersion : null,
      athletes: {
        total: statuses.reduce((n, x) => n + x._count._all, 0),
        frozen: athletes('FROZEN'),
        suspended: athletes('SUSPENDED'),
      },
      calculations: {
        completed: calcs('COMPLETED'),
        pending: calcs('PENDING'),
        failed: calcs('FAILED'),
        skipped: calcs('SKIPPED'),
      },
      ratedCompetitions,
      lastCalculatedAt: last?.processedAt?.toISOString() ?? null,
      recentCorrections: corrections.map((c) => ({
        ...correctionDto(c),
        athleteName: fullName(c.athlete.person),
      })),
    };
  }

  /** Журнал расчётов, новые сверху. Спортсмен — по снимку участников схватки в расчёте. */
  async calculations(q: RatingCalculationsQuery): Promise<Page<RatingCalculationEntry>> {
    const cursor = decodeCursor(q.cursor);
    const and: Prisma.RatingCalculationWhereInput[] = [];
    if (q.status) and.push({ status: q.status });
    if (q.competitionId) and.push({ competitionId: q.competitionId });
    if (q.athleteId) and.push({ input: { path: ['corners'], array_contains: [{ athleteId: q.athleteId }] } });
    if (cursor)
      and.push({
        OR: [
          { createdAt: { lt: new Date(cursor.k) } },
          { createdAt: new Date(cursor.k), id: { lt: cursor.id } },
        ],
      });
    const rows = await this.db.ratingCalculation.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: {
        history: true,
        competition: { select: { id: true, name: true } },
        match: {
          select: {
            id: true,
            matchNumber: true,
            category: { select: { nameRu: true, nameEn: true } },
          },
        },
      },
    });
    const page = rows.slice(0, q.limit);
    const athleteIds = [...new Set(page.flatMap((r) => corners(r.input).map((c) => c.athleteId)))];
    const people = await this.db.athleteProfile.findMany({
      where: { id: { in: athleteIds } },
      select: { id: true, person: { select: { lastName: true, firstName: true } } },
    });
    const names = new Map(people.map((p) => [p.id, fullName(p.person)]));
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: r.createdAt.toISOString(), id: r.id }),
      (r): RatingCalculationEntry => ({
        id: r.id,
        status: r.status,
        statusReason: r.statusReason,
        calculationVersion: r.calculationVersion,
        matchResultRevision: r.matchResultRevision,
        match: {
          id: r.match.id,
          number: r.match.matchNumber,
          category: { ru: r.match.category.nameRu, en: r.match.category.nameEn },
        },
        competition: r.competition,
        athletes: corners(r.input).map((c) => {
          const h = r.history.find((x) => x.athleteId === c.athleteId);
          return {
            athleteId: c.athleteId,
            name: names.get(c.athleteId) ?? '—',
            side: c.side,
            ratingBefore: h?.ratingBefore ?? null,
            ratingAfter: h?.ratingAfter ?? null,
            delta: h?.ratingDelta ?? null,
          };
        }),
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
      }),
    );
  }

  /** Поиск по фамилии и имени (начало слова), как в списке спортсменов. */
  async athletes(q: RatingAthletesQuery): Promise<RatingAthleteHit[]> {
    const needle = q.q
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await this.db.$queryRaw<
      {
        id: string;
        public_id: string;
        last_name: string;
        first_name: string;
        birth_date: Date;
        rating: number | null;
        status: RatingStatus | null;
      }[]
    >`
      SELECT a.id, a.public_id, p.last_name, p.first_name, p.birth_date, r.rating, r.status::text AS status
      FROM athlete_profile a
      JOIN person p ON p.id = a.person_id
      LEFT JOIN athlete_rating r ON r.athlete_id = a.id
      WHERE p.last_name_norm LIKE ${needle + '%'} OR p.first_name_norm LIKE ${needle + '%'}
         OR (p.last_name_norm || ' ' || p.first_name_norm) LIKE ${needle + '%'}
      ORDER BY r.rating DESC NULLS LAST, p.last_name, p.first_name, a.id
      LIMIT ${SEARCH_LIMIT}`;
    return rows.map((r) => ({
      athleteId: r.id,
      publicId: r.public_id,
      name: fullName({ lastName: r.last_name, firstName: r.first_name }),
      birthYear: r.birth_date.getUTCFullYear(),
      rating: r.rating,
      status: r.status,
    }));
  }
}

/** Участники схватки из снимка расчёта (`input.corners`). */
function corners(input: Prisma.JsonValue): { athleteId: string; side: 'RED' | 'BLUE' }[] {
  const list = (input as { corners?: unknown } | null)?.corners;
  return Array.isArray(list) ? (list as { athleteId: string; side: 'RED' | 'BLUE' }[]) : [];
}
