// Рейтинговый профиль спортсмена на сайте (ТЗ 39, 40; фаза 15): график Elo и история рейтинговых турниров. Тот же
// доступ, что у карточки рейтинга: спортсмен с рейтингом и общим согласием на распространение ПДн, иначе — 404.
// Учитываются действующие расчёты (COMPLETED) и корректировки; турниры — только опубликованные.
import { Injectable } from '@nestjs/common';
import type { PublicAthleteSeason, PublicRatedCompetition, PublicRatingChart } from '@sde/contracts';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RatingRankingsService } from './rating-rankings.service';
import { RatingSeasonService, seasonBounds, seasonRanked } from './rating-season.service';

/** Точек на графике — последние; для многолетней истории этого достаточно. */
const CHART_POINTS = 1000;

@Injectable()
export class RatingProfileService {
  constructor(
    private readonly db: PrismaService,
    private readonly rankings: RatingRankingsService,
    private readonly seasonList: RatingSeasonService,
  ) {}

  async chart(publicId: string): Promise<PublicRatingChart> {
    const athleteId = await this.rankings.publicAthlete(publicId);
    const rows = await this.db.$queryRaw<{ at: Date; rating_before: number; rating_after: number }[]>`
      SELECT * FROM (
        SELECT rh.match_finished_at AS at, rh.id, rh.rating_before, rh.rating_after
        FROM rating_history rh
        JOIN rating_calculation rc ON rc.id = rh.calculation_id AND rc.status = 'COMPLETED'
        WHERE rh.athlete_id = ${athleteId}::uuid
        UNION ALL
        SELECT c.created_at, c.id, c.rating_before, c.rating_after
        FROM rating_correction c
        WHERE c.athlete_id = ${athleteId}::uuid AND c.delta <> 0
      ) h
      ORDER BY h.at DESC, h.id DESC
      LIMIT ${CHART_POINTS + 1}`;
    const truncated = rows.length > CHART_POINTS;
    const events = rows.slice(0, CHART_POINTS).reverse();
    const first = events[0];
    return {
      points: first
        ? [
            { at: first.at.toISOString(), rating: first.rating_before },
            ...events.map((e) => ({ at: e.at.toISOString(), rating: e.rating_after })),
          ]
        : [],
      truncated,
    };
  }

  /** Рейтинговые турниры спортсмена, новые сверху: рейтинг до первой и после последней схватки турнира. */
  async competitions(publicId: string): Promise<PublicRatedCompetition[]> {
    const athleteId = await this.rankings.publicAthlete(publicId);
    const rows = await this.db.$queryRaw<
      {
        slug: string;
        name: string;
        start_date: Date;
        rating_before: number;
        rating_after: number;
        delta: number;
        matches: number;
        wins: number;
        losses: number;
      }[]
    >`
      SELECT c.slug, c.name, c.start_date,
             (array_agg(rh.rating_before ORDER BY rh.match_finished_at, rh.id))[1] AS rating_before,
             (array_agg(rh.rating_after ORDER BY rh.match_finished_at DESC, rh.id DESC))[1] AS rating_after,
             sum(rh.rating_delta)::int AS delta,
             count(*)::int AS matches,
             (count(*) FILTER (WHERE rh.actual_score > 0.5))::int AS wins,
             (count(*) FILTER (WHERE rh.actual_score < 0.5))::int AS losses,
             min(rh.match_finished_at) AS first_at
      FROM rating_history rh
      JOIN rating_calculation rc ON rc.id = rh.calculation_id AND rc.status = 'COMPLETED'
      JOIN competition c ON c.id = rh.competition_id AND c.deleted_at IS NULL AND c.status <> 'DRAFT'
      WHERE rh.athlete_id = ${athleteId}::uuid
      GROUP BY c.id
      ORDER BY first_at DESC, c.id`;
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      startDate: r.start_date.toISOString().slice(0, 10),
      ratingBefore: r.rating_before,
      ratingAfter: r.rating_after,
      delta: r.delta,
      matches: r.matches,
      wins: r.wins,
      losses: r.losses,
    }));
  }

  /**
   * Сезоны спортсмена, новые сверху (ТЗ 68): место в сезонной таблице, рейтинг на начало и конец сезона, схватки.
   * Сезон без рейтинговых схваток спортсмена не показывается.
   */
  async seasons(publicId: string): Promise<PublicAthleteSeason[]> {
    const athleteId = await this.rankings.publicAthlete(publicId);
    const seasons = await this.seasonList.publicList();
    const rows = await Promise.all(
      seasons.map(async (season) => {
        const bounds = seasonBounds({ startsOn: new Date(season.startsOn), endsOn: new Date(season.endsOn) });
        const [r] = await this.db.$queryRaw<
          {
            rank: number;
            rating: number;
            rating_start: number;
            rated_matches: number;
            wins: number;
            losses: number;
          }[]
        >`SELECT r.rank, r.rating, r.rating_start, r.rated_matches, r.wins, r.losses
          FROM (${seasonRanked(bounds)}) r WHERE r.athlete_id = ${athleteId}::uuid`;
        return r
          ? {
              season,
              rank: r.rank,
              ratingStart: r.rating_start,
              ratingEnd: r.rating,
              delta: r.rating - r.rating_start,
              matches: r.rated_matches,
              wins: r.wins,
              losses: r.losses,
            }
          : null;
      }),
    );
    return rows.filter((r): r is PublicAthleteSeason => r !== null);
  }
}
