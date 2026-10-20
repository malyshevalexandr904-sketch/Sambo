// Таблица рейтинга (docs/RATING_ARCHITECTURE.md, 8, 10): кто в ней и как считается место — общее для публичного API
// и ежедневного снимка мест (worker).
import { Prisma, type Tx } from '@sde/db';

/**
 * Спортсмены таблицы с местом: действующий рейтинг (не заморожен и не отстранён), хотя бы одна рейтинговая схватка,
 * действующая карточка спортсмена. Равный рейтинг — одно место (rank).
 */
export const RANKED_ATHLETES = Prisma.sql`
  SELECT ar.athlete_id, ar.rating, ar.peak_rating, ar.lowest_rating, ar.rated_matches, ar.wins, ar.losses,
         ar.last_rated_match_at, ap.public_id, ap.person_id,
         (rank() OVER (ORDER BY ar.rating DESC))::int AS rank
  FROM athlete_rating ar
  JOIN athlete_profile ap ON ap.id = ar.athlete_id
  JOIN person p ON p.id = ap.person_id
  WHERE ar.status = 'ACTIVE' AND ar.rated_matches > 0 AND ap.status = 'ACTIVE'
    AND p.deleted_at IS NULL AND p.merged_into_id IS NULL`;

/** Снимки мест хранятся год. */
const SNAPSHOT_RETENTION_DAYS = 400;

/** Снимок мест на дату (повтор в тот же день ничего не меняет) и очистка старых; возвращает число записанных строк. */
export async function snapshotRanks(tx: Tx, date: Date): Promise<number> {
  const day = date.toISOString().slice(0, 10);
  const written = await tx.$executeRaw`
    INSERT INTO rating_rank_snapshot (snapshot_date, athlete_id, rank, rating)
    SELECT ${day}::date, r.athlete_id, r.rank, r.rating FROM (${RANKED_ATHLETES}) r
    ON CONFLICT (snapshot_date, athlete_id) DO NOTHING`;
  await tx.$executeRaw`
    DELETE FROM rating_rank_snapshot
    WHERE snapshot_date < ${day}::date - ${SNAPSHOT_RETENTION_DAYS}::int`;
  return written;
}
