// Рейтинг, фаза 14 (ТЗ 18, 46, 65–67; docs/RATING_ARCHITECTURE.md, 6.5, 8): корректирующие операции платформы —
// ручная корректировка, заморозка, пересборка с отчётом о расхождении и перерасчёт турнира. Только администратор
// платформы; организатор и судьи турнира получают 403 от сервера. История не переписывается.
import type {
  AdminAthleteRating,
  RatingCorrectionDto,
  RatingRebuildReport,
  RatingRecalculationReport,
  WinMethod,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { rateAthlete, SAMBO_ELO_V1 } from '@sde/rating';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RatingCalculationService, RatingRulesService } from '../src/modules/rating';
import { createTestApp, createUser, login, resetData, type Session, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import { refereeWorld, type RefereeWorld, scheduledMatches, type ScheduledMatch } from './helpers/phase7';

let t: TestApp;
let superAdmin: Session;
let platformAdmin: Session;
let organizer: Session;
let w: RefereeWorld;
let calc: RatingCalculationService;
let matches: ScheduledMatch[];

const api = '/api/v1/admin';

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  calc = t.app.get(RatingCalculationService);
  superAdmin = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
  platformAdmin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, {
    totp: true,
  });
  w = await refereeWorld(t, [{ admitted: 5, format: 'ROUND_ROBIN' }]);
  await t.admin.competition.update({ where: { id: w.competitionId }, data: { competitionType: 'RATED' } });
  await t.admin.competitionRatingConfig.create({
    data: {
      competitionId: w.competitionId,
      ruleSetId: (await t.app.get(RatingRulesService).active())!.id,
    },
  });
  const c = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
  organizer = await login(
    t,
    (await createUser(t, { orgs: [{ organizationId: c.organizerOrganizationId, role: 'ORGANIZER' }] })).email,
  );
  matches = (await scheduledMatches(t, w.categories[0]!.categoryId)).filter((m) =>
    m.participants.every((p) => p.entryId && !p.isBye),
  );
  expect(matches.length).toBeGreaterThanOrEqual(8);
});
afterAll(async () => {
  await t.close();
});

/** Схватки закончились до корректировок (пересборка идёт по времени). */
let clock = Date.now() - 7 * 24 * 60 * 60 * 1000;
/** Подтверждённый результат (расчёт читает только match_result); время окончания — по порядку вызовов. */
async function setResult(m: ScheduledMatch, winnerSide: 'RED' | 'BLUE', method: WinMethod): Promise<void> {
  const data = {
    status: 'CONFIRMED' as const,
    winnerSide,
    method,
    methodDetail: null,
    revision: 1,
    confirmedAt: new Date(),
    confirmedById: w.refs.chief1.id,
  };
  await t.admin.matchResult.create({
    data: { id: uuidv7(), competitionId: m.competitionId, matchId: m.id, ...data },
  });
  clock += 60_000;
  await t.admin.match.update({
    where: { id: m.id },
    data: { status: 'FINISHED', finishedAt: new Date(clock) },
  });
}

const athleteOf = async (m: ScheduledMatch, side: 'RED' | 'BLUE'): Promise<string> =>
  (
    await t.admin.entry.findUniqueOrThrow({
      where: { id: m.participants.find((p) => p.side === side)!.entryId! },
    })
  ).athleteId;
const used = new Set<string>();
/** Следующая схватка без результата. */
const next = (): ScheduledMatch => {
  const m = matches.find((x) => !used.has(x.id));
  expect(m).toBeDefined();
  used.add(m!.id);
  return m!;
};
const ratingOf = async (athleteId: string) =>
  (await t.admin.athleteRating.findUniqueOrThrow({ where: { athleteId } })).rating;
const reason = 'Исправление по протоколу главного судьи';

describe('rating corrections by the platform', () => {
  it('lets only the platform touch a rating: organizer and tournament staff get 403 from the server', async () => {
    const athleteId = await athleteOf(matches[0]!, 'RED');
    const calls: [string, string, unknown][] = [
      ['get', `${api}/athletes/${athleteId}/rating`, undefined],
      ['get', `${api}/athletes/${athleteId}/rating-corrections`, undefined],
      [
        'post',
        `${api}/athletes/${athleteId}/rating-corrections`,
        { correctedRating: 500, expectedRating: 200, reason },
      ],
      ['put', `${api}/athletes/${athleteId}/rating-status`, { status: 'FROZEN', reason }],
      ['post', `${api}/athletes/${athleteId}/rebuild-rating`, {}],
      ['post', `${api}/athletes/${athleteId}/rebuild-rating/apply`, { expectedRating: 200, reason }],
      ['post', `${api}/competitions/${w.competitionId}/recalculate-rating`, { reason }],
    ];
    for (const s of [organizer, w.staff.manager, w.staff.chief])
      for (const [method, url, body] of calls) {
        const res =
          method === 'get' ? await s.agent.get(url) : await send(s, method as 'post' | 'put', url, body);
        expect(res.status, `${method} ${url}`).toBe(403);
      }
    // Применение пересборки — только SUPER_ADMIN (rating.rebuild_apply).
    const apply = await send(platformAdmin, 'post', `${api}/athletes/${athleteId}/rebuild-rating/apply`, {
      expectedRating: 200,
      reason,
    });
    expect(apply.status).toBe(403);
    expect(await t.admin.ratingCorrection.count()).toBe(0);
    expect(await t.admin.athleteRating.count({ where: { status: { not: 'ACTIVE' } } })).toBe(0);
  });

  it('corrects a rating with a reason, against the value the admin saw, without touching history', async () => {
    const m = next();
    await setResult(m, 'RED', 'POINTS');
    expect((await calc.calculate(m.id)).status).toBe('COMPLETED');
    const athleteId = await athleteOf(m, 'RED');
    const current = await ratingOf(athleteId);
    expect(current).toBe(212);
    const historyBefore = await t.admin.ratingHistory.count();
    const url = `${api}/athletes/${athleteId}/rating-corrections`;

    expect(
      (await send(platformAdmin, 'post', url, { correctedRating: 230, expectedRating: current })).status,
    ).toBe(400);
    const stale = await send(platformAdmin, 'post', url, {
      correctedRating: 230,
      expectedRating: 200,
      reason,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('RATING_CHANGED');
    const same = await send(platformAdmin, 'post', url, {
      correctedRating: current,
      expectedRating: current,
      reason,
    });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe('RATING_UNCHANGED');
    // Схватка, в которой спортсмен не участвовал.
    const foreign = matches.find(
      (x) =>
        !x.participants.some((p) => m.participants.some((q) => q.side === 'RED' && q.entryId === p.entryId)),
    )!;
    const wrongMatch = await send(platformAdmin, 'post', url, {
      correctedRating: 230,
      expectedRating: current,
      relatedMatchId: foreign.id,
      reason,
    });
    expect(wrongMatch.status).toBe(404);

    const res = await send(platformAdmin, 'post', url, {
      correctedRating: 230,
      expectedRating: current,
      relatedMatchId: m.id,
      reason,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const dto = res.body.data as RatingCorrectionDto;
    expect(dto).toMatchObject({
      athleteId,
      kind: 'MANUAL',
      ratingBefore: 212,
      ratingAfter: 230,
      delta: 18,
      reason,
      relatedMatchId: m.id,
    });
    expect(dto.createdById).not.toBeNull();
    const row = await t.admin.athleteRating.findUniqueOrThrow({ where: { athleteId } });
    expect(row).toMatchObject({ rating: 230, peakRating: 230, ratedMatches: 1, wins: 1 });
    expect(await t.admin.ratingHistory.count()).toBe(historyBefore);
    const audit = await t.admin.auditLog.findFirstOrThrow({
      where: { action: 'rating.corrected', entityId: athleteId },
    });
    expect(audit).toMatchObject({ reason, platformIntervention: true });
    expect(audit.after).toMatchObject({ rating: 230, correctionId: dto.id });

    const list = await platformAdmin.agent.get(url).expect(200);
    expect(list.body.data).toEqual([dto]);
    const card = await platformAdmin.agent.get(`${api}/athletes/${athleteId}/rating`).expect(200);
    expect(card.body.data).toMatchObject({ rating: 230, status: 'ACTIVE', pendingCalculations: 0 });

    // Корректировка администратора без причины невозможна и в обход приложения.
    await expect(
      t.admin.ratingCorrection.create({
        data: { id: uuidv7(), athleteId, kind: 'MANUAL', ratingBefore: 230, ratingAfter: 240, delta: 10 },
      }),
    ).rejects.toThrow(/rating_correction_actor_check/);
  });

  it('keeps matches of a frozen athlete waiting and rates them in order once the athlete is active again', async () => {
    const m = next();
    const red = await athleteOf(m, 'RED');
    const url = `${api}/athletes/${red}/rating-status`;
    const frozen = await send(platformAdmin, 'put', url, { status: 'FROZEN', reason });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);
    expect((frozen.body.data as AdminAthleteRating).status).toBe('FROZEN');
    expect((await send(platformAdmin, 'put', url, { status: 'FROZEN', reason })).status).toBe(422);

    await setResult(m, 'BLUE', 'TOTAL_VICTORY');
    expect(await calc.calculate(m.id)).toMatchObject({ status: 'PENDING', reason: 'ATHLETE_NOT_ACTIVE' });
    const card = await platformAdmin.agent.get(`${api}/athletes/${red}/rating`).expect(200);
    expect(card.body.data).toMatchObject({ status: 'FROZEN', pendingCalculations: 1 });

    const active = await send(platformAdmin, 'put', url, { status: 'ACTIVE', reason: 'Проверка завершена' });
    expect(active.status).toBe(200);
    expect(active.body.data).toMatchObject({ status: 'ACTIVE', pendingCalculations: 0 });
    expect(await t.admin.ratingCalculation.findFirstOrThrow({ where: { matchId: m.id } })).toMatchObject({
      status: 'COMPLETED',
    });
    const audits = await t.admin.auditLog.findMany({
      where: { action: 'rating.status_changed', entityId: red },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audits.map((a) => [a.before, a.after, a.platformIntervention])).toEqual([
      [{ status: 'ACTIVE' }, { status: 'FROZEN' }, true],
      [{ status: 'FROZEN' }, { status: 'ACTIVE' }, true],
    ]);
  });

  it('rebuilds a rating: a read-only discrepancy report, applied only with its own permission', async () => {
    const m = next();
    await setResult(m, 'RED', 'TOTAL_VICTORY');
    expect((await calc.calculate(m.id)).status).toBe('COMPLETED');
    const athleteId = await athleteOf(m, 'RED');
    const opponent = await athleteOf(m, 'BLUE');
    // Рейтинг испорчен в обход расчёта: пересборка покажет расхождение.
    const recorded = await ratingOf(athleteId);
    await t.admin.athleteRating.update({
      where: { athleteId },
      data: {
        rating: recorded - 7,
        lowestRating: Math.min(
          recorded - 7,
          (await t.admin.athleteRating.findUniqueOrThrow({ where: { athleteId } })).lowestRating,
        ),
      },
    });
    const corrections = await t.admin.ratingCorrection.count();

    const res = await send(platformAdmin, 'post', `${api}/athletes/${athleteId}/rebuild-rating`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = res.body.data as RatingRebuildReport;
    // Пересборка — по записанным исходам и рейтингам соперников, от начального рейтинга версии правил.
    const history = await t.admin.ratingHistory.findMany({
      where: { athleteId, calculation: { status: 'COMPLETED' } },
      orderBy: [{ matchFinishedAt: 'asc' }, { id: 'asc' }],
    });
    let expected = SAMBO_ELO_V1.initialRating;
    for (const h of history)
      expected = rateAthlete(SAMBO_ELO_V1, {
        rating: expected,
        opponentRating: h.opponentRatingBefore,
        outcome: h.outcome as never,
      }).ratingAfter;
    expect(report).toMatchObject({
      athleteId,
      initialRating: 200,
      currentRating: recorded - 7,
      rebuiltRating: expected,
      discrepancy: expected - recorded + 7,
      applied: null,
    });
    expect(report.steps.filter((s) => s.kind === 'MATCH')).toHaveLength(history.length);
    const last = report.steps.at(-1)!;
    expect(last).toMatchObject({ kind: 'MATCH', matchId: m.id, outcome: 'CLEAN_WIN' });
    expect(last.recorded).toEqual(last.rebuilt);
    // Отчёт ничего не пишет.
    expect(await ratingOf(athleteId)).toBe(recorded - 7);
    expect(await t.admin.ratingCorrection.count()).toBe(corrections);

    const applyUrl = `${api}/athletes/${athleteId}/rebuild-rating/apply`;
    const stale = await send(superAdmin, 'post', applyUrl, { expectedRating: expected + 1, reason });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('RATING_CHANGED');
    const applied = await send(superAdmin, 'post', applyUrl, { expectedRating: expected, reason });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect((applied.body.data as RatingRebuildReport).applied).toMatchObject({
      kind: 'REBUILD',
      ratingBefore: recorded - 7,
      ratingAfter: expected,
      delta: expected - recorded + 7,
      reason,
    });
    expect(await ratingOf(athleteId)).toBe(expected);
    expect(await ratingOf(opponent)).toBeGreaterThan(0);
    expect(
      await t.admin.auditLog.count({
        where: { action: 'rating.rebuilt', entityId: athleteId, platformIntervention: true },
      }),
    ).toBe(1);

    // После применения расхождения нет; повтор — нечего применять.
    const again = await send(platformAdmin, 'post', `${api}/athletes/${athleteId}/rebuild-rating`, {});
    expect(again.body.data).toMatchObject({
      discrepancy: 0,
      rebuiltRating: expected,
      currentRating: expected,
    });
    const twice = await send(superAdmin, 'post', applyUrl, { expectedRating: expected, reason });
    expect(twice.status).toBe(422);
    expect(twice.body.error.code).toBe('RATING_UNCHANGED');
  });

  it('carries manual corrections through a rebuild and leaves amended results to their new calculation', async () => {
    const m = next();
    await setResult(m, 'RED', 'POINTS');
    expect((await calc.calculate(m.id)).status).toBe('COMPLETED');
    const athleteId = await athleteOf(m, 'BLUE');
    const before = await ratingOf(athleteId);
    // Изменённый результат: синий победил чисто — корректировка RESULT_AMENDED.
    await t.admin.matchResult.update({
      where: { matchId: m.id },
      data: { status: 'AMENDED', winnerSide: 'BLUE', method: 'TOTAL_VICTORY', revision: 2 },
    });
    expect((await calc.calculate(m.id)).status).toBe('COMPLETED');
    const corrected = await send(platformAdmin, 'post', `${api}/athletes/${athleteId}/rating-corrections`, {
      correctedRating: (await ratingOf(athleteId)) - 5,
      expectedRating: await ratingOf(athleteId),
      reason,
    });
    expect(corrected.status).toBe(201);
    expect(await ratingOf(athleteId)).not.toBe(before);

    const report = (await send(platformAdmin, 'post', `${api}/athletes/${athleteId}/rebuild-rating`, {})).body
      .data as RatingRebuildReport;
    // Изменение результата — последняя посчитанная схватка спортсмена: расхождения нет.
    expect(report.discrepancy).toBe(0);
    expect(report.steps.at(-1)).toMatchObject({ kind: 'CORRECTION', rebuilt: { delta: -5 } });
    expect(report.steps.some((s) => s.matchId === m.id && s.outcome === 'CLEAN_WIN')).toBe(true);
    expect(report.steps.some((s) => s.matchId === m.id && s.outcome === 'LOSS_ON_POINTS')).toBe(false);
  });

  it('recalculates a rated competition: rates what is missing, leaves rated matches alone', async () => {
    const pending = [next(), next()];
    for (const m of pending) await setResult(m, 'RED', 'DECISION');
    const url = `${api}/competitions/${w.competitionId}/recalculate-rating`;
    expect((await send(platformAdmin, 'post', url, {})).status).toBe(400);
    const res = await send(platformAdmin, 'post', url, { reason });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = res.body.data as RatingRecalculationReport;
    const rated = await t.admin.matchResult.count({ where: { competitionId: w.competitionId } });
    expect(report).toEqual({
      competitionId: w.competitionId,
      matches: rated,
      unchanged: rated - 2,
      completed: 2,
      skipped: 0,
      pending: 0,
      failed: 0,
    });
    for (const m of pending)
      expect(await t.admin.ratingCalculation.findFirstOrThrow({ where: { matchId: m.id } })).toMatchObject({
        status: 'COMPLETED',
      });
    const again = await send(platformAdmin, 'post', url, { reason });
    expect(again.body.data).toMatchObject({ unchanged: rated, completed: 0 });
    expect(
      await t.admin.auditLog.count({
        where: { action: 'rating.recalculated', competitionId: w.competitionId, platformIntervention: true },
      }),
    ).toBe(2);

    const other = await refereeWorld(t, [{ admitted: 3, format: 'ROUND_ROBIN' }]);
    const notRated = await send(
      platformAdmin,
      'post',
      `${api}/competitions/${other.competitionId}/recalculate-rating`,
      {
        reason,
      },
    );
    expect(notRated.status).toBe(422);
    expect(notRated.body.error.code).toBe('COMPETITION_NOT_RATED');
  });
});
