// Рейтинг на странице рейтингового турнира (ТЗ 45, 48; docs/RATING_ARCHITECTURE.md, 8, 9; фаза 13): изменения
// рейтинга участников за турнир и посчитанные схватки. Только опубликованный рейтинговый турнир с публичными
// изменениями рейтинга (CompetitionRatingConfig.publicDeltas), иначе — «не найдено». Учитываются действующие
// расчёты (COMPLETED): после изменения результата прежний расчёт заменён (SUPERSEDED) новым с тем же рейтингом до.
// Спортсмен — как в заявке на турнир (имя, клуб, регион на момент заявки); имя — по правилу табло турнира
// (ADR-15): общее согласие на распространение ПДн или согласие на этот турнир; ссылка на карточку рейтинга —
// только при общем согласии (карточка без него не открывается).
import { Injectable } from '@nestjs/common';
import {
  type Page,
  type PublicCompetitionRatingSummary,
  type PublicRatedAthlete,
  type PublicRatedMatch,
  type PublicRatedMatchSide,
  type RatedMatchesQuery,
  type RatingOutcome,
} from '@sde/contracts';
import { Prisma } from '@sde/db';
import { ratingLevel, type RatingRules, toRuleSetInfo } from '@sde/rating';
import { decodeCursor, toPage } from '../../../common/http/http';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

interface RatedCompetition {
  id: string;
  calculationVersion: string;
  rules: RatingRules;
}

interface SummaryRow {
  athlete_id: string;
  rating_before: number;
  level_before: number;
  delta: number;
  matches: number;
  wins: number;
  losses: number;
}

interface CalculationRow {
  id: string;
  match_id: string;
  public_id: string;
  match_number: number | null;
  category_ru: string;
  category_en: string;
  at: Date;
}

@Injectable()
export class CompetitionRatingResultsService {
  constructor(private readonly db: PrismaService) {}

  async summary(slug: string): Promise<PublicCompetitionRatingSummary> {
    const c = await this.competition(slug);
    const rows = await this.db.$queryRaw<SummaryRow[]>`
      SELECT rh.athlete_id,
             (array_agg(rh.rating_before ORDER BY rh.match_finished_at, rh.id))[1] AS rating_before,
             (array_agg(rh.level_before ORDER BY rh.match_finished_at, rh.id))[1] AS level_before,
             sum(rh.rating_delta)::int AS delta,
             count(*)::int AS matches,
             (count(*) FILTER (WHERE rh.actual_score > 0.5))::int AS wins,
             (count(*) FILTER (WHERE rh.actual_score < 0.5))::int AS losses
      FROM rating_history rh
      JOIN rating_calculation rc ON rc.id = rh.calculation_id AND rc.status = 'COMPLETED'
      WHERE rh.competition_id = ${c.id}::uuid
      GROUP BY rh.athlete_id`;
    const labels = await this.labels(
      c.id,
      rows.map((r) => r.athlete_id),
    );
    const ratedMatches = await this.db.ratingCalculation.count({
      where: { competitionId: c.id, status: 'COMPLETED' },
    });
    const athletes = rows
      .map((r) => {
        const after = r.rating_before + r.delta;
        return {
          athlete: labels.get(r.athlete_id) ?? HIDDEN,
          ratingBefore: r.rating_before,
          ratingAfter: after,
          delta: r.delta,
          levelBefore: r.level_before,
          levelAfter: ratingLevel(c.rules, after),
          matches: r.matches,
          wins: r.wins,
          losses: r.losses,
          id: r.athlete_id,
        };
      })
      .sort((a, b) => b.delta - a.delta || b.ratingAfter - a.ratingAfter || (a.id < b.id ? -1 : 1))
      .map(({ id: _id, ...row }) => row);
    return { calculationVersion: c.calculationVersion, ratedMatches, athletes };
  }

  /** Посчитанные схватки, новые сверху (по времени окончания схватки). */
  async matches(slug: string, q: RatedMatchesQuery): Promise<Page<PublicRatedMatch>> {
    const c = await this.competition(slug);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.$queryRaw<CalculationRow[]>`
      SELECT * FROM (
        SELECT rc.id, rc.match_id, m.public_id, m.match_number, cc.name_ru AS category_ru,
               cc.name_en AS category_en,
               (SELECT min(rh.match_finished_at) FROM rating_history rh WHERE rh.calculation_id = rc.id) AS at
        FROM rating_calculation rc
        JOIN "match" m ON m.id = rc.match_id
        JOIN competition_category cc ON cc.id = m.category_id
        WHERE rc.competition_id = ${c.id}::uuid AND rc.status = 'COMPLETED'
      ) x
      WHERE x.at IS NOT NULL
        ${cursor ? Prisma.sql`AND (x.at, x.id) < (${new Date(cursor.k)}::timestamptz, ${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY x.at DESC, x.id DESC
      LIMIT ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    const [history, participants] = await Promise.all([
      this.db.ratingHistory.findMany({ where: { calculationId: { in: page.map((r) => r.id) } } }),
      this.db.matchParticipant.findMany({
        where: { matchId: { in: page.map((r) => r.match_id) }, entryId: { not: null } },
        select: { matchId: true, side: true, entry: { select: { athleteId: true } } },
      }),
    ]);
    const labels = await this.labels(c.id, [...new Set(history.map((h) => h.athleteId))]);
    const sideOf = new Map(participants.map((p) => [`${p.matchId}:${p.entry?.athleteId}`, p.side]));
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: r.at.toISOString(), id: r.id }),
      (r): PublicRatedMatch => {
        const sides = history.filter((h) => h.calculationId === r.id);
        const side = (s: 'RED' | 'BLUE'): PublicRatedMatchSide => {
          const h = sides.find((x) => sideOf.get(`${r.match_id}:${x.athleteId}`) === s);
          if (!h) throw new Error(`rating_calculation ${r.id}: no ${s} history row`);
          return {
            athlete: labels.get(h.athleteId) ?? HIDDEN,
            ratingBefore: h.ratingBefore,
            ratingAfter: h.ratingAfter,
            delta: h.ratingDelta,
            levelBefore: h.levelBefore,
            levelAfter: h.levelAfter,
            outcome: h.outcome as RatingOutcome,
          };
        };
        return {
          matchPublicId: r.public_id,
          matchNumber: r.match_number,
          category: { ru: r.category_ru, en: r.category_en },
          finishedAt: r.at.toISOString(),
          red: side('RED'),
          blue: side('BLUE'),
        };
      },
    );
  }

  private async competition(slug: string): Promise<RatedCompetition> {
    const row = await this.db.competition.findFirst({
      where: {
        slug,
        deletedAt: null,
        status: { not: 'DRAFT' },
        competitionType: 'RATED',
        ratingConfig: { publicDeltas: true },
      },
      select: { id: true, ratingConfig: { select: { ruleSet: true } } },
    });
    if (!row?.ratingConfig) throw new DomainError('NOT_FOUND', { resource: 'competition_rating' });
    const info = toRuleSetInfo(row.ratingConfig.ruleSet);
    return { id: row.id, calculationVersion: info.calculationVersion, rules: info.rules };
  }

  /** Спортсмены по их заявкам на турнир (последняя заявка, если их несколько). */
  private async labels(
    competitionId: string,
    athleteIds: string[],
  ): Promise<Map<string, PublicRatedAthlete>> {
    if (athleteIds.length === 0) return new Map();
    const entries = await this.db.entry.findMany({
      where: { competitionId, athleteId: { in: athleteIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        athleteId: true,
        publicName: true,
        snapClubName: true,
        snapRegionId: true,
        snapRegionName: true,
        athlete: { select: { publicId: true, personId: true } },
      },
    });
    const personIds = [...new Set(entries.map((e) => e.athlete.personId))];
    const regionIds = [...new Set(entries.map((e) => e.snapRegionId).filter((x): x is string => !!x))];
    const [consents, regions] = await Promise.all([
      this.db.consent.findMany({
        where: {
          subjectPersonId: { in: personIds },
          revokedAt: null,
          template: { kind: 'PD_DISTRIBUTION' },
          OR: [{ competitionId: null }, { competitionId }],
        },
        select: { subjectPersonId: true, competitionId: true },
      }),
      this.db.region.findMany({
        where: { id: { in: regionIds } },
        select: { id: true, nameRu: true, nameEn: true },
      }),
    ]);
    const named = new Set(consents.map((x) => x.subjectPersonId));
    const general = new Set(consents.filter((x) => x.competitionId === null).map((x) => x.subjectPersonId));
    const regionNames = new Map(regions.map((r) => [r.id, { ru: r.nameRu, en: r.nameEn }]));
    const out = new Map<string, PublicRatedAthlete>();
    for (const e of entries) {
      const shown = named.has(e.athlete.personId);
      const region = e.snapRegionId ? regionNames.get(e.snapRegionId) : undefined;
      out.set(e.athleteId, {
        publicId: shown && general.has(e.athlete.personId) ? e.athlete.publicId : null,
        name: shown ? e.publicName : null,
        hidden: !shown,
        club: e.snapClubName,
        region: region ?? (e.snapRegionName ? { ru: e.snapRegionName, en: e.snapRegionName } : null),
      });
    }
    return out;
  }
}

const HIDDEN: PublicRatedAthlete = { publicId: null, name: null, hidden: true, club: null, region: null };
