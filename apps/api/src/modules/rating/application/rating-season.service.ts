// Сезоны рейтинга (docs/RATING_ARCHITECTURE.md, 5, 10; ТЗ 68; фаза 15). Сезон — отдельное представление единого
// рейтинга за период: Elo не сбрасывается и не считается заново, сезонная таблица читает записанную историю
// (действующие расчёты и корректировки) за период. Границы — календарные даты по Москве, включительно.
import { Injectable } from '@nestjs/common';
import {
  localDateIn,
  type PublicRatingSeason,
  type RatingSeason,
  type RatingSeasonInput,
  zonedToInstant,
} from '@sde/contracts';
import { Prisma, type RatingSeason as SeasonRow, type Tx } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';

/** Часовой пояс дат сезона: рейтинг общероссийский, даты сезона — по Москве. */
export const SEASON_TIME_ZONE = 'Europe/Moscow';

export interface SeasonBounds {
  /** Начало первого дня сезона. */
  from: Date;
  /** Начало дня после последнего дня сезона (не включается). */
  to: Date;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

export function seasonBounds(s: Pick<SeasonRow, 'startsOn' | 'endsOn'>): SeasonBounds {
  const next = new Date(s.endsOn.getTime() + 86_400_000);
  return {
    from: new Date(zonedToInstant(`${day(s.startsOn)}T00:00`, SEASON_TIME_ZONE)),
    to: new Date(zonedToInstant(`${day(next)}T00:00`, SEASON_TIME_ZONE)),
  };
}

/**
 * Спортсмены сезонной таблицы — те же столбцы, что у общей таблицы (RANKED_ATHLETES): рейтинг на конец сезона
 * (последнее событие сезона; для идущего — текущий), на начало — до первого события сезона, наибольший в сезоне,
 * сезонные схватки. В таблице — только спортсмены с рейтинговой схваткой в сезоне и действующим рейтингом.
 * Место — по рейтингу на конец сезона; равный рейтинг — одно место.
 */
export function seasonRanked({ from, to }: SeasonBounds): Prisma.Sql {
  return Prisma.sql`
    SELECT s.athlete_id, s.rating, s.peak_rating, s.lowest_rating, s.rated_matches, s.wins, s.losses,
           s.last_rated_match_at, s.rating_start, ap.public_id, ap.person_id,
           (rank() OVER (ORDER BY s.rating DESC))::int AS rank
    FROM (
      SELECT e.athlete_id,
             (array_agg(e.rating_after ORDER BY e.at DESC, e.id DESC))[1] AS rating,
             (array_agg(e.rating_before ORDER BY e.at, e.id))[1] AS rating_start,
             greatest(max(e.rating_after), max(e.rating_before)) AS peak_rating,
             least(min(e.rating_after), min(e.rating_before)) AS lowest_rating,
             sum(e.m)::int AS rated_matches, sum(e.w)::int AS wins, sum(e.l)::int AS losses,
             max(e.at) FILTER (WHERE e.m = 1) AS last_rated_match_at
      FROM (
        SELECT rh.athlete_id, rh.match_finished_at AS at, rh.id, rh.rating_before, rh.rating_after, 1 AS m,
               (rh.actual_score > 0.5)::int AS w, (rh.actual_score < 0.5)::int AS l
        FROM rating_history rh
        JOIN rating_calculation rc ON rc.id = rh.calculation_id AND rc.status = 'COMPLETED'
        WHERE rh.match_finished_at >= ${from} AND rh.match_finished_at < ${to}
        UNION ALL
        SELECT c.athlete_id, c.created_at, c.id, c.rating_before, c.rating_after, 0, 0, 0
        FROM rating_correction c
        WHERE c.delta <> 0 AND c.created_at >= ${from} AND c.created_at < ${to}
      ) e
      GROUP BY e.athlete_id
      HAVING sum(e.m) > 0
    ) s
    JOIN athlete_rating ar ON ar.athlete_id = s.athlete_id
    JOIN athlete_profile ap ON ap.id = s.athlete_id
    JOIN person p ON p.id = ap.person_id
    WHERE ar.status = 'ACTIVE' AND ap.status = 'ACTIVE' AND p.deleted_at IS NULL AND p.merged_into_id IS NULL`;
}

@Injectable()
export class RatingSeasonService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Все сезоны, новые сверху. */
  async list(): Promise<RatingSeason[]> {
    const rows = await this.db.ratingSeason.findMany({ orderBy: { startsOn: 'desc' } });
    const today = this.today();
    return rows.map((r) => ({
      ...publicSeason(r, today),
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /** Начавшиеся сезоны, новые сверху: будущий сезон на сайте не показывается. */
  async publicList(): Promise<PublicRatingSeason[]> {
    const today = this.today();
    const rows = await this.db.ratingSeason.findMany({
      where: { startsOn: { lte: new Date(today) } },
      orderBy: { startsOn: 'desc' },
    });
    return rows.map((r) => publicSeason(r, today));
  }

  /** Начавшийся сезон по коду; иначе — «не найдено». */
  async find(code: string): Promise<{ season: PublicRatingSeason; bounds: SeasonBounds }> {
    const today = this.today();
    const row = await this.db.ratingSeason.findUnique({ where: { code } });
    if (!row || day(row.startsOn) > today) throw new DomainError('NOT_FOUND', { resource: 'rating_season' });
    return { season: publicSeason(row, today), bounds: seasonBounds(row) };
  }

  async create(input: RatingSeasonInput, userId: string): Promise<RatingSeason> {
    const id = await this.db.tx(async (tx) => {
      await this.ensureFree(tx, input, null);
      const row = await this.write(() =>
        tx.ratingSeason.create({
          data: {
            code: input.code,
            name: input.name,
            startsOn: new Date(input.startsOn),
            endsOn: new Date(input.endsOn),
            createdById: userId,
          },
        }),
      );
      await this.audit.record(tx, {
        action: 'rating.season_created',
        entityType: 'rating_season',
        entityId: row.id,
        after: { ...input },
        platformIntervention: true,
      });
      return row.id;
    });
    return this.get(id);
  }

  /** Изменение сезона меняет только сезонное представление; рейтинг и история не затрагиваются. */
  async update(id: string, input: RatingSeasonInput): Promise<RatingSeason> {
    await this.db.tx(async (tx) => {
      const current = await tx.ratingSeason.findUnique({ where: { id } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'rating_season' });
      await this.ensureFree(tx, input, id);
      await this.write(() =>
        tx.ratingSeason.update({
          where: { id },
          data: {
            code: input.code,
            name: input.name,
            startsOn: new Date(input.startsOn),
            endsOn: new Date(input.endsOn),
          },
        }),
      );
      await this.audit.record(tx, {
        action: 'rating.season_updated',
        entityType: 'rating_season',
        entityId: id,
        before: {
          code: current.code,
          name: current.name,
          startsOn: day(current.startsOn),
          endsOn: day(current.endsOn),
        },
        after: { ...input },
        platformIntervention: true,
      });
    });
    return this.get(id);
  }

  private async get(id: string): Promise<RatingSeason> {
    const found = (await this.list()).find((s) => s.id === id);
    if (!found) throw new DomainError('NOT_FOUND', { resource: 'rating_season' });
    return found;
  }

  /** Сезоны не пересекаются (проверка до записи даёт понятную ошибку; ограничение в БД — гарантия). */
  private async ensureFree(tx: Tx, input: RatingSeasonInput, exceptId: string | null): Promise<void> {
    const taken = await tx.ratingSeason.findUnique({ where: { code: input.code }, select: { id: true } });
    if (taken && taken.id !== exceptId)
      throw new DomainError('ALREADY_EXISTS', { resource: 'rating_season' });
    const clash = await tx.ratingSeason.findFirst({
      where: {
        startsOn: { lte: new Date(input.endsOn) },
        endsOn: { gte: new Date(input.startsOn) },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { code: true },
    });
    if (clash) throw new DomainError('RATING_SEASON_OVERLAP', { season: clash.code });
  }

  private async write<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof Error && e.message.includes('rating_season_no_overlap'))
        throw new DomainError('RATING_SEASON_OVERLAP');
      throw e;
    }
  }

  private today(): string {
    return localDateIn(new Date(), SEASON_TIME_ZONE);
  }
}

function publicSeason(r: SeasonRow, today: string): PublicRatingSeason {
  const startsOn = day(r.startsOn);
  const endsOn = day(r.endsOn);
  return { code: r.code, name: r.name, startsOn, endsOn, current: startsOn <= today && today <= endsOn };
}
