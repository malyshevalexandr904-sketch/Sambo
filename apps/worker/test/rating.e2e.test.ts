// Integration (worker, рейтинг — фаза 6): подтверждённый результат схватки рейтингового турнира → расчёт; более
// поздняя схватка спортсмена ждёт более раннюю; изменённый результат → корректировка; нерейтинговый турнир — без
// расчёта; ожидающие расчёты досчитывает регламентная задача.
import { type EventType } from '@sde/contracts';
import { PrismaClient, uuidv7 } from '@sde/db';
import { createLogger } from '@sde/server-kit';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RATING_CONSUMER, RatingConsumer, type RatingJob } from '../src/rating/rating.consumer';
import { TEST_DB } from './global-setup';
import { finish, matchDayWorld, type MatchDayWorld, TRUNCATE_MATCH_DAY } from './match-day-world';

const db = new PrismaClient({ datasourceUrl: TEST_DB.DATABASE_ADMIN_URL });
const consumer = new RatingConsumer(db, createLogger('silent', 'worker-test'));

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});

let w: MatchDayWorld;

beforeEach(async () => {
  await db.$executeRawUnsafe(TRUNCATE_MATCH_DAY);
  w = await matchDayWorld(db);
  await db.competition.update({ where: { id: w.competitionId }, data: { competitionType: 'RATED' } });
  const ruleSet = await db.ratingRuleSet.findFirstOrThrow({ where: { code: 'sambo-elo', status: 'ACTIVE' } });
  await db.competitionRatingConfig.create({
    data: { competitionId: w.competitionId, ruleSetId: ruleSet.id },
  });
});

/** Подтверждённый (или изменённый) результат и событие в outbox — как пишет api. */
async function confirm(
  matchId: string,
  r: { winnerSide: 'RED' | 'BLUE' | null; method: 'POINTS' | 'TOTAL_VICTORY' | 'NO_SHOW'; revision?: number },
): Promise<string> {
  const revision = r.revision ?? 1;
  const data = {
    status: revision > 1 ? ('AMENDED' as const) : ('CONFIRMED' as const),
    winnerSide: r.winnerSide,
    method: r.method,
    revision,
    confirmedAt: new Date(),
    confirmedById: w.coach,
  };
  await db.matchResult.upsert({
    where: { matchId },
    create: { id: uuidv7(), competitionId: w.competitionId, matchId, ...data },
    update: data,
  });
  if (revision === 1) await finish(db, matchId);
  const type: EventType = revision > 1 ? 'match.result_amended' : 'match.result_confirmed';
  const eventId = uuidv7();
  await db.outboxEvent.create({
    data: {
      id: eventId,
      type,
      aggregateType: 'Match',
      aggregateId: matchId,
      competitionId: w.competitionId,
      payload:
        revision > 1
          ? { matchId, categoryId: w.categoryId, revision, winnerChanged: true }
          : { matchId, categoryId: w.categoryId, winnerSide: r.winnerSide, method: r.method },
    },
  });
  return eventId;
}

const run = (eventId: string) =>
  consumer.handle({ data: { eventId, type: 'x', traceId: 't-rating' } } as Job<RatingJob>);
const calculationsOf = (matchId: string) =>
  db.ratingCalculation.findMany({ where: { matchId }, orderBy: { createdAt: 'asc' } });
const ratingOf = async (athleteId: string) =>
  (await db.athleteRating.findUnique({ where: { athleteId } }))?.rating ?? null;

describe('rating consumer', () => {
  it('rates a confirmed match of a rated competition once', async () => {
    const eventId = await confirm(w.ab, { winnerSide: 'RED', method: 'POINTS' });
    await run(eventId);
    await run(eventId);
    expect((await calculationsOf(w.ab)).map((c) => c.status)).toEqual(['COMPLETED']);
    // 200 / 200, победа по баллам, K = 30.
    expect(await ratingOf(w.athleteA)).toBe(212);
    expect(await ratingOf(w.athleteB)).toBe(188);
    expect(await db.processedEvent.count({ where: { consumer: RATING_CONSUMER, eventId } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'rating.calculated' } });
    expect(audit).toMatchObject({ actorType: 'SYSTEM', traceId: 't-rating' });
    expect(await db.outboxEvent.count({ where: { type: 'rating.calculated' } })).toBe(1);
  });

  it('waits with a later match until the earlier one of the same athlete is rated', async () => {
    // B проводит две схватки: с A (раньше), затем с соперником. Подтверждение второй обработано первым.
    const earlier = await confirm(w.ab, { winnerSide: 'RED', method: 'TOTAL_VICTORY' });
    await new Promise((r) => setTimeout(r, 5));
    const later = await confirm(w.late, { winnerSide: 'RED', method: 'POINTS' });
    await run(later);
    expect((await calculationsOf(w.late)).map((c) => [c.status, c.statusReason])).toEqual([
      ['PENDING', 'EARLIER_MATCH_PENDING'],
    ]);
    await run(earlier);
    expect((await calculationsOf(w.late)).map((c) => c.status)).toEqual(['COMPLETED']);
    const [first] = await db.ratingHistory.findMany({ where: { matchId: w.ab, athleteId: w.athleteB } });
    const [second] = await db.ratingHistory.findMany({ where: { matchId: w.late, athleteId: w.athleteB } });
    expect(second!.ratingBefore).toBe(first!.ratingAfter);
  });

  it('corrects the ratings when a rated result is amended', async () => {
    await run(await confirm(w.ab, { winnerSide: 'RED', method: 'POINTS' }));
    await run(await confirm(w.ab, { winnerSide: 'BLUE', method: 'POINTS', revision: 2 }));
    expect((await calculationsOf(w.ab)).map((c) => c.status)).toEqual(['SUPERSEDED', 'COMPLETED']);
    // От тех же 200 / 200: теперь B +12, A −12.
    expect(await ratingOf(w.athleteA)).toBe(188);
    expect(await ratingOf(w.athleteB)).toBe(212);
    expect(await db.ratingCorrection.count()).toBe(2);
  });

  it('ignores matches of a competition that is not rated', async () => {
    await db.competition.update({ where: { id: w.competitionId }, data: { competitionType: 'NON_RATED' } });
    const eventId = await confirm(w.ab, { winnerSide: 'RED', method: 'POINTS' });
    await run(eventId);
    expect(await calculationsOf(w.ab)).toEqual([]);
    expect(await db.athleteRating.count()).toBe(0);
    expect(await db.processedEvent.count({ where: { consumer: RATING_CONSUMER, eventId } })).toBe(1);
  });

  it('completes pending calculations on the periodic sweep', async () => {
    await db.athleteRating.create({
      data: { athleteId: w.athleteA, rating: 200, peakRating: 200, lowestRating: 200, status: 'FROZEN' },
    });
    await run(await confirm(w.ab, { winnerSide: 'RED', method: 'POINTS' }));
    expect((await calculationsOf(w.ab)).map((c) => c.statusReason)).toEqual(['ATHLETE_NOT_ACTIVE']);
    expect(await consumer.sweep()).toBe(0);
    await db.athleteRating.update({ where: { athleteId: w.athleteA }, data: { status: 'ACTIVE' } });
    await consumer.handle({ data: { kind: 'sweep' } } as Job<RatingJob>);
    expect((await calculationsOf(w.ab)).map((c) => c.status)).toEqual(['COMPLETED']);
  });
});
