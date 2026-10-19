// Публичная таблица рейтинга, карточка и история рейтинга спортсмена (docs/RATING_ARCHITECTURE.md, 8; фаза 7).
// Имя спортсмена — по правилу табло (ADR-15): «Фамилия И.» и ссылка на карточку только при действующем общем
// согласии на распространение ПДн (согласие на один турнир таблицу не покрывает); иначе — только клуб и регион.
// Место — общее по таблице (фильтры сужают список), изменение места — от последнего ежедневного снимка.
import { Injectable } from '@nestjs/common';
import {
  type LocalizedText,
  type Page,
  type PublicAthleteRating,
  type PublicRankingRow,
  type PublicRatedAthlete,
  type PublicRatingHistoryItem,
  publicName,
  type RankingsQuery,
  type RatingHistoryQuery,
  type RatingOutcome,
} from '@sde/contracts';
import { Prisma } from '@sde/db';
import { RANKED_ATHLETES, type RatingRules, ratingLevel, SAMBO_ELO_CODE, toRuleSetInfo } from '@sde/rating';
import { decodeCursor, toPage } from '../../../common/http/http';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

interface RankedRow {
  athlete_id: string;
  public_id: string;
  person_id: string;
  rank: number;
  rating: number;
  peak_rating: number;
  lowest_rating: number;
  rated_matches: number;
  wins: number;
  losses: number;
  last_rated_match_at: Date | null;
  last_name: string;
  first_name: string;
  club: string | null;
  region_ru: string | null;
  region_en: string | null;
  previous_rank: number | null;
}

/** Человек на публичной странице: имя, клуб, регион. */
interface PersonLabel {
  personId: string;
  publicId: string;
  lastName: string;
  firstName: string;
  club: string | null;
  region: LocalizedText | null;
}

/** Клуб спортсмена — действующее членство (основное, затем последнее); регион — свой, иначе клуба. */
const CLUB_LATERAL = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT o.id, o.short_name, o.region_id FROM athlete_membership am
    JOIN organization o ON o.id = am.organization_id
    WHERE am.athlete_id = r.athlete_id AND (am.valid_to IS NULL OR am.valid_to >= current_date)
    ORDER BY am.is_primary DESC, am.valid_from DESC, am.id
    LIMIT 1
  ) club ON true`;

@Injectable()
export class RatingRankingsService {
  constructor(private readonly db: PrismaService) {}

  async list(q: RankingsQuery): Promise<Page<PublicRankingRow>> {
    const where: Prisma.Sql[] = [];
    if (q.gender) where.push(Prisma.sql`p.gender = ${q.gender}::"Gender"`);
    const year = new Date().getUTCFullYear();
    if (q.ageFrom !== undefined)
      where.push(Prisma.sql`extract(year FROM p.birth_date) <= ${year - q.ageFrom}`);
    if (q.ageTo !== undefined) where.push(Prisma.sql`extract(year FROM p.birth_date) >= ${year - q.ageTo}`);
    if (q.regionId) where.push(Prisma.sql`COALESCE(p.region_id, club.region_id) = ${q.regionId}::uuid`);
    if (q.clubId) where.push(Prisma.sql`club.id = ${q.clubId}::uuid`);
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      const rating = Number(cursor.k);
      if (!Number.isInteger(rating)) throw new DomainError('INVALID_CURSOR');
      where.push(
        Prisma.sql`(r.rating < ${rating} OR (r.rating = ${rating} AND r.athlete_id > ${cursor.id}::uuid))`,
      );
    }
    const rows = await this.ranked(where, q.limit + 1);
    const [rules, visible] = await Promise.all([
      this.rules(),
      this.distribution(rows.map((r) => r.person_id)),
    ]);
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: String(r.rating), id: r.athlete_id }),
      (r) => this.row(r, rules, visible),
    );
  }

  /** Карточка рейтинга; спортсмен без согласия на публикацию имени — 404 (по ссылке его не найти). */
  async card(publicId: string): Promise<PublicAthleteRating> {
    const [r] = await this.ranked([Prisma.sql`r.public_id = ${publicId}`], 1);
    if (!r || !(await this.distribution([r.person_id])).has(r.person_id))
      throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    return {
      ...this.row(r, await this.rules(), new Set([r.person_id])),
      lowestRating: r.lowest_rating,
      lastRatedMatchAt: r.last_rated_match_at?.toISOString() ?? null,
      winRate: r.rated_matches > 0 ? Math.round((r.wins * 1000) / r.rated_matches) / 10 : null,
    };
  }

  /**
   * История рейтинга, новые сверху: посчитанные схватки (действующие расчёты) и корректировки. Соперник — по тому же
   * правилу имён; турнир — только опубликованный.
   */
  async history(publicId: string, q: RatingHistoryQuery): Promise<Page<PublicRatingHistoryItem>> {
    const athleteId = await this.publicAthlete(publicId);
    const rows = await this.historyRows(athleteId, q);
    const page = rows.slice(0, q.limit);
    const competitions = await this.db.competition.findMany({
      where: {
        id: { in: [...new Set(page.map((h) => h.competition_id).filter((x): x is string => !!x))] },
        deletedAt: null,
        status: { not: 'DRAFT' },
      },
      select: { id: true, slug: true, name: true },
    });
    const opponents = await this.labels(
      page.map((h) => h.opponent_athlete_id).filter((x): x is string => !!x),
    );
    const visible = await this.distribution([...opponents.values()].map((o) => o.personId));
    const rules = await this.rules();
    const byCompetition = new Map(competitions.map((c) => [c.id, { slug: c.slug, name: c.name }]));
    return toPage(
      rows,
      q.limit,
      (h) => ({ k: h.at.toISOString(), id: h.id }),
      (h): PublicRatingHistoryItem => {
        const opponent = h.opponent_athlete_id ? opponents.get(h.opponent_athlete_id) : undefined;
        return {
          kind: h.kind,
          at: h.at.toISOString(),
          ratingBefore: h.rating_before,
          ratingAfter: h.rating_after,
          delta: h.delta,
          levelAfter: h.level_after ?? ratingLevel(rules, h.rating_after),
          outcome: h.outcome,
          competition: h.competition_id ? (byCompetition.get(h.competition_id) ?? null) : null,
          opponent: opponent
            ? { ...athleteLabel(opponent, visible), ratingBefore: h.opponent_rating_before ?? 0 }
            : null,
        };
      },
    );
  }

  /** Спортсмен с рейтингом и согласием на публикацию; иначе — «не найдено». */
  async publicAthlete(publicId: string): Promise<string> {
    const athlete = await this.db.athleteProfile.findUnique({
      where: { publicId },
      select: { id: true, personId: true, status: true, rating: { select: { status: true } } },
    });
    if (
      !athlete ||
      athlete.status !== 'ACTIVE' ||
      !athlete.rating ||
      !(await this.distribution([athlete.personId])).has(athlete.personId)
    )
      throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    return athlete.id;
  }

  private historyRows(athleteId: string, q: RatingHistoryQuery): Promise<HistoryRow[]> {
    const cursor = decodeCursor(q.cursor);
    const before = cursor
      ? Prisma.sql`AND (h.at, h.id) < (${new Date(cursor.k)}::timestamptz, ${cursor.id}::uuid)`
      : Prisma.empty;
    return this.db.$queryRaw<HistoryRow[]>`
      SELECT * FROM (
        SELECT rh.id, 'MATCH' AS kind, rh.match_finished_at AS at, rh.rating_before, rh.rating_after,
               rh.rating_delta AS delta, rh.level_after, rh.outcome, rh.competition_id,
               rh.opponent_athlete_id, rh.opponent_rating_before
        FROM rating_history rh
        JOIN rating_calculation rc ON rc.id = rh.calculation_id AND rc.status = 'COMPLETED'
        WHERE rh.athlete_id = ${athleteId}::uuid
        UNION ALL
        SELECT c.id, 'CORRECTION', c.created_at, c.rating_before, c.rating_after, c.delta, NULL, NULL, NULL,
               NULL, NULL
        FROM rating_correction c
        WHERE c.athlete_id = ${athleteId}::uuid AND c.delta <> 0
      ) h
      WHERE true ${before}
      ORDER BY h.at DESC, h.id DESC
      LIMIT ${q.limit + 1}`;
  }

  private ranked(where: Prisma.Sql[], limit: number): Promise<RankedRow[]> {
    const filter = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    return this.db.$queryRaw<RankedRow[]>`
      SELECT r.*, p.last_name, p.first_name, club.short_name AS club,
             reg.name_ru AS region_ru, reg.name_en AS region_en, prev.rank AS previous_rank
      FROM (${RANKED_ATHLETES}) r
      JOIN person p ON p.id = r.person_id
      ${CLUB_LATERAL}
      LEFT JOIN region reg ON reg.id = COALESCE(p.region_id, club.region_id)
      LEFT JOIN LATERAL (
        SELECT s.rank FROM rating_rank_snapshot s
        WHERE s.athlete_id = r.athlete_id AND s.snapshot_date < current_date
        ORDER BY s.snapshot_date DESC LIMIT 1
      ) prev ON true
      ${filter}
      ORDER BY r.rating DESC, r.athlete_id
      LIMIT ${limit}`;
  }

  private row(r: RankedRow, rules: RatingRules, visible: ReadonlySet<string>): PublicRankingRow {
    return {
      rank: r.rank,
      rankChange: r.previous_rank === null ? null : r.previous_rank - r.rank,
      athlete: athleteLabel(
        {
          personId: r.person_id,
          publicId: r.public_id,
          lastName: r.last_name,
          firstName: r.first_name,
          club: r.club,
          region: r.region_ru ? { ru: r.region_ru, en: r.region_en ?? r.region_ru } : null,
        },
        visible,
      ),
      rating: r.rating,
      level: ratingLevel(rules, r.rating),
      peakRating: r.peak_rating,
      ratedMatches: r.rated_matches,
      wins: r.wins,
      losses: r.losses,
    };
  }

  /** Имя, клуб и регион спортсменов (соперников в истории). */
  private async labels(athleteIds: string[]): Promise<Map<string, PersonLabel>> {
    if (athleteIds.length === 0) return new Map();
    const rows = await this.db.$queryRaw<
      {
        athlete_id: string;
        public_id: string;
        person_id: string;
        last_name: string;
        first_name: string;
        club: string | null;
        region_ru: string | null;
        region_en: string | null;
      }[]
    >`
      SELECT r.athlete_id, ap.public_id, p.id AS person_id, p.last_name, p.first_name, club.short_name AS club,
             reg.name_ru AS region_ru, reg.name_en AS region_en
      FROM (SELECT unnest(${[...new Set(athleteIds)]}::uuid[]) AS athlete_id) r
      JOIN athlete_profile ap ON ap.id = r.athlete_id
      JOIN person p ON p.id = ap.person_id
      ${CLUB_LATERAL}
      LEFT JOIN region reg ON reg.id = COALESCE(p.region_id, club.region_id)`;
    return new Map(
      rows.map((r) => [
        r.athlete_id,
        {
          personId: r.person_id,
          publicId: r.public_id,
          lastName: r.last_name,
          firstName: r.first_name,
          club: r.club,
          region: r.region_ru ? { ru: r.region_ru, en: r.region_en ?? r.region_ru } : null,
        },
      ]),
    );
  }

  /** Люди с действующим общим согласием на распространение ПДн. */
  private async distribution(personIds: string[]): Promise<Set<string>> {
    if (personIds.length === 0) return new Set();
    const rows = await this.db.consent.findMany({
      where: {
        subjectPersonId: { in: [...new Set(personIds)] },
        competitionId: null,
        revokedAt: null,
        template: { kind: 'PD_DISTRIBUTION' },
      },
      select: { subjectPersonId: true },
    });
    return new Set(rows.map((r) => r.subjectPersonId));
  }

  /** Уровни — по действующей версии правил. */
  private async rules(): Promise<RatingRules> {
    const row = await this.db.ratingRuleSet.findFirst({ where: { code: SAMBO_ELO_CODE, status: 'ACTIVE' } });
    if (!row) throw new Error('no active rating rule set');
    return toRuleSetInfo(row).rules;
  }
}

interface HistoryRow {
  id: string;
  kind: 'MATCH' | 'CORRECTION';
  at: Date;
  rating_before: number;
  rating_after: number;
  delta: number;
  level_after: number | null;
  outcome: RatingOutcome | null;
  competition_id: string | null;
  opponent_athlete_id: string | null;
  opponent_rating_before: number | null;
}

function athleteLabel(p: PersonLabel, visible: ReadonlySet<string>): PublicRatedAthlete {
  const shown = visible.has(p.personId);
  return {
    publicId: shown ? p.publicId : null,
    name: shown ? publicName(p.lastName, p.firstName) : null,
    hidden: !shown,
    club: p.club,
    region: p.region,
  };
}
