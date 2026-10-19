// Рейтинг спортсменов (docs/RATING_ARCHITECTURE.md): версии правил расчёта (фаза 2); расчёт по подтверждённой
// схватке — одна транзакция, повтор и параллельные вызовы без двойного начисления, пропуски, ожидание
// замороженного спортсмена, история только дополняется (фазы 3–5).
import { canonicalJson, type WinMethod } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { SAMBO_ELO_V1 } from '@sde/rating';
import { sha256Hex } from '@sde/server-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { RatingCalculationService, RatingRulesService } from '../src/modules/rating';
import { createTestApp, resetData, type TestApp } from './helpers/app';
import {
  confirm,
  playToResult,
  refereeWorld,
  type RefereeWorld,
  scheduledMatches,
  type ScheduledMatch,
} from './helpers/phase7';

let t: TestApp;
let rules: RatingRulesService;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  rules = t.app.get(RatingRulesService);
});
// Строки test-* остаются: действующую версию удалить нельзя, а схема пересоздаётся перед каждым прогоном.
afterAll(async () => {
  await t.close();
});

describe('rating rule sets', () => {
  it('ships sambo-elo@1 as the active version, equal to the domain rules', async () => {
    const active = await rules.active();
    expect(active).toMatchObject({
      code: 'sambo-elo',
      version: 1,
      status: 'ACTIVE',
      calculationVersion: 'sambo-elo@1/elo-1',
    });
    expect(active?.rules).toEqual(SAMBO_ELO_V1);
    const row = await t.admin.ratingRuleSet.findUniqueOrThrow({ where: { id: active?.id } });
    expect(row.checksum).toBe(sha256Hex(canonicalJson(SAMBO_ELO_V1)));
  });

  it('forbids changing or deleting an active version; only retiring it', async () => {
    const id = uuidv7();
    const base = {
      id,
      code: 'test-elo',
      version: 1,
      name: 'test',
      schemaVersion: 1,
      parameters: SAMBO_ELO_V1,
      checksum: 'x',
      engineVersion: 'elo-1',
    };
    await t.admin.ratingRuleSet.create({ data: base });
    // Черновик правится свободно.
    await t.admin.ratingRuleSet.update({ where: { id }, data: { name: 'draft edit' } });
    await t.admin.ratingRuleSet.update({ where: { id }, data: { status: 'ACTIVE', activeFrom: new Date() } });
    await expect(
      t.admin.ratingRuleSet.update({
        where: { id },
        data: { parameters: { ...SAMBO_ELO_V1, initialRating: 300 } },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(t.admin.ratingRuleSet.delete({ where: { id } })).rejects.toThrow(/immutable/);
    // Вторая действующая версия того же кода невозможна.
    await expect(
      t.admin.ratingRuleSet.create({
        data: { ...base, id: uuidv7(), version: 2, status: 'ACTIVE', activeFrom: new Date() },
      }),
    ).rejects.toThrow();
    await t.admin.ratingRuleSet.update({ where: { id }, data: { status: 'RETIRED', activeTo: new Date() } });
    await expect(t.admin.ratingRuleSet.update({ where: { id }, data: { status: 'ACTIVE' } })).rejects.toThrow(
      /immutable/,
    );
    expect((await rules.byId(id))?.status).toBe('RETIRED');
  });

  it('refuses to read a version with parameters the schema does not accept', async () => {
    const id = uuidv7();
    await t.admin.ratingRuleSet.create({
      data: {
        id,
        code: 'test-broken',
        version: 1,
        name: 'broken',
        schemaVersion: 1,
        parameters: { ...SAMBO_ELO_V1, scoreRules: { ...SAMBO_ELO_V1.scoreRules, CLEAN_WIN: '0.95' } },
        checksum: 'x',
        engineVersion: 'elo-1',
      },
    });
    await expect(rules.byId(id)).rejects.toThrow(/invalid parameters/);
  });
});

describe('rating calculation of a confirmed match', () => {
  let w: RefereeWorld;
  let calc: RatingCalculationService;
  let matches: ScheduledMatch[];

  /** Подтверждённый результат без судейского планшета (сам расчёт читает только match_result). */
  async function setResult(
    m: ScheduledMatch,
    r: {
      winnerSide: 'RED' | 'BLUE' | null;
      method: WinMethod;
      methodDetail?: string | null;
      revision?: number;
    },
  ): Promise<void> {
    const data = {
      status: 'CONFIRMED' as const,
      winnerSide: r.winnerSide,
      method: r.method,
      methodDetail: r.methodDetail ?? null,
      revision: r.revision ?? 1,
      confirmedAt: new Date(),
      confirmedById: w.refs.chief1.id,
    };
    await t.admin.matchResult.upsert({
      where: { matchId: m.id },
      create: { id: uuidv7(), competitionId: m.competitionId, matchId: m.id, ...data },
      update: data,
    });
    await t.admin.match.update({
      where: { id: m.id },
      data: { status: 'FINISHED', finishedAt: new Date() },
    });
  }

  const athleteOf = async (m: ScheduledMatch, side: 'RED' | 'BLUE'): Promise<string> => {
    const p = m.participants.find((x) => x.side === side);
    return (await t.admin.entry.findUniqueOrThrow({ where: { id: p!.entryId! } })).athleteId;
  };
  /** Схватка без результата. */
  const free = async (): Promise<ScheduledMatch> => {
    const taken = new Set(
      (await t.admin.matchResult.findMany({ select: { matchId: true } })).map((r) => r.matchId),
    );
    const m = matches.find((x) => !taken.has(x.id));
    expect(m).toBeDefined();
    return m!;
  };
  const ratingOf = async (athleteId: string) => t.admin.athleteRating.findUnique({ where: { athleteId } });

  beforeAll(async () => {
    w = await refereeWorld(t, [{ admitted: 5, format: 'ROUND_ROBIN' }]);
    calc = t.app.get(RatingCalculationService);
    // Рейтинговый турнир с закреплённой действующей версией правил (включение администратором — фаза 8).
    await t.admin.competition.update({ where: { id: w.competitionId }, data: { competitionType: 'RATED' } });
    await t.admin.competitionRatingConfig.create({
      data: { competitionId: w.competitionId, ruleSetId: (await rules.active())!.id },
    });
    // В круге из 5 у каждого участника есть отдых: схватки без BYE.
    matches = (await scheduledMatches(t, w.categories[0]!.categoryId)).filter((m) =>
      m.participants.every((p) => p.entryId && !p.isBye),
    );
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });

  it('does nothing before the result is confirmed', async () => {
    const m = matches[0]!;
    expect(await calc.calculate(m.id)).toMatchObject({
      calculationId: null,
      status: null,
      reason: 'RESULT_NOT_CONFIRMED',
      replayed: false,
    });
    expect(await t.admin.ratingCalculation.count({ where: { matchId: m.id } })).toBe(0);
  });

  it('rates a refereed match once: history, current ratings, audit and event in one go', async () => {
    const m = matches.find((x) => x.schedule?.matId === w.mats[0]!.id)!;
    const played = await playToResult(w.refs.chief1.s, m.id, 'RED');
    expect((await confirm(w.refs.chief1.s, played)).status).toBe(200);
    const red = await athleteOf(m, 'RED');
    const blue = await athleteOf(m, 'BLUE');

    const first = await calc.calculate(m.id);
    expect(first).toMatchObject({ status: 'COMPLETED', reason: null, replayed: false });
    // 200 / 200, победа по баллам (0.9 / 0.1), K = 30: +12 / −12 (RATING_RULES.md, C8).
    expect(await ratingOf(red)).toMatchObject({
      rating: 212,
      peakRating: 212,
      lowestRating: 200,
      ratedMatches: 1,
      wins: 1,
      losses: 0,
      version: 2,
    });
    expect(await ratingOf(blue)).toMatchObject({
      rating: 188,
      peakRating: 200,
      lowestRating: 188,
      ratedMatches: 1,
      wins: 0,
      losses: 1,
    });
    const history = await t.admin.ratingHistory.findMany({
      where: { calculationId: first.calculationId! },
      orderBy: { ratingDelta: 'desc' },
    });
    expect(
      history.map((h) => [
        h.athleteId,
        h.ratingBefore,
        h.ratingAfter,
        h.ratingDelta,
        h.outcome,
        h.coefficientK,
      ]),
    ).toEqual([
      [red, 200, 212, 12, 'WIN_ON_POINTS', 30],
      [blue, 200, 188, -12, 'LOSS_ON_POINTS', 30],
    ]);
    expect(history[0]!.expectedScore.toString()).toBe('0.5');
    expect(history[0]!.ratingAfterExact.toString()).toBe('212');
    expect(history[0]!.calculationVersion).toBe('sambo-elo@1/elo-1');
    expect(
      await t.admin.auditLog.count({
        where: { action: 'rating.calculated', entityId: first.calculationId! },
      }),
    ).toBe(1);
    const events = await t.admin.outboxEvent.findMany({
      where: { type: 'rating.calculated', aggregateId: first.calculationId! },
    });
    expect(events.map((e) => e.payload)).toEqual([
      { calculationId: first.calculationId, matchId: m.id, athleteIds: [red, blue] },
    ]);

    // Повтор — тот же расчёт, ничего не начислено второй раз.
    expect(await calc.calculate(m.id)).toEqual({
      calculationId: first.calculationId,
      status: 'COMPLETED',
      reason: null,
      replayed: true,
      athleteIds: expect.arrayContaining([red, blue]) as string[],
    });
    expect((await ratingOf(red))?.rating).toBe(212);
    expect(await t.admin.ratingHistory.count({ where: { matchId: m.id } })).toBe(2);
  });

  it('counts concurrent calls for the same match once', async () => {
    const m = await free();
    await setResult(m, { winnerSide: 'BLUE', method: 'TOTAL_VICTORY' });
    const before = await Promise.all(
      ['RED', 'BLUE'].map(
        async (s) => (await ratingOf(await athleteOf(m, s as 'RED' | 'BLUE')))?.rating ?? 200,
      ),
    );
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => calc.calculate(m.id)));
    expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
    expect(new Set(outcomes.map((o) => o.calculationId)).size).toBe(1);
    expect(await t.admin.ratingHistory.count({ where: { matchId: m.id } })).toBe(2);
    const blue = await ratingOf(await athleteOf(m, 'BLUE'));
    expect(blue!.rating).toBeGreaterThan(before[1]!);
    expect(blue!.ratedMatches).toBeGreaterThanOrEqual(1);
  });

  it('starts the next match from the rating after the previous one', async () => {
    const rated = await t.admin.ratingHistory.findMany({
      select: { athleteId: true, ratingAfter: true, matchFinishedAt: true },
      orderBy: { matchFinishedAt: 'desc' },
    });
    const latest = new Map<string, number>();
    for (const h of rated) if (!latest.has(h.athleteId)) latest.set(h.athleteId, h.ratingAfter);
    const pending = await t.admin.matchResult.findMany({ select: { matchId: true } });
    const done = new Set(pending.map((p) => p.matchId));
    let next: ScheduledMatch | undefined;
    for (const m of matches) {
      if (done.has(m.id)) continue;
      const ids = await Promise.all([athleteOf(m, 'RED'), athleteOf(m, 'BLUE')]);
      if (ids.some((id) => latest.has(id))) {
        next = m;
        break;
      }
    }
    expect(next).toBeDefined();
    await setResult(next!, { winnerSide: 'RED', method: 'POINTS', methodDetail: 'LAST_TECHNICAL_ACTION' });
    const r = await calc.calculate(next!.id);
    const rows = await t.admin.ratingHistory.findMany({ where: { calculationId: r.calculationId! } });
    for (const h of rows) expect(h.ratingBefore).toBe(latest.get(h.athleteId) ?? 200);
    const red = await athleteOf(next!, 'RED');
    expect(rows.find((h) => h.athleteId === red)?.outcome).toBe('WIN_MINIMAL_ADVANTAGE');
    expect(rows.find((h) => h.athleteId !== red)?.outcome).toBe('LOSS_MINIMAL_ADVANTAGE');
  });

  it('skips matches that are not rated and fails on a result the rules do not know', async () => {
    const noWinner = await free();
    await setResult(noWinner, { winnerSide: null, method: 'NO_SHOW' });
    expect(await calc.calculate(noWinner.id)).toMatchObject({ status: 'SKIPPED', reason: 'NO_WINNER' });
    const unknown = await free();
    await setResult(unknown, { winnerSide: 'RED', method: 'POINTS', methodDetail: 'SOMETHING_NEW' });
    expect(await calc.calculate(unknown.id)).toMatchObject({ status: 'FAILED', reason: 'UNCLASSIFIED' });
    // Не начислено ничего.
    expect(await t.admin.ratingHistory.count({ where: { matchId: { in: [noWinner.id, unknown.id] } } })).toBe(
      0,
    );
    // Повторный вызов SKIPPED — без изменений.
    expect(await calc.calculate(noWinner.id)).toMatchObject({ status: 'SKIPPED', replayed: true });
  });

  it('keeps a match of a frozen athlete pending and rates it once the athlete is active again', async () => {
    const m = await free();
    await setResult(m, { winnerSide: 'RED', method: 'SUPERIORITY' });
    const red = await athleteOf(m, 'RED');
    await t.admin.athleteRating.upsert({
      where: { athleteId: red },
      create: { athleteId: red, rating: 200, peakRating: 200, lowestRating: 200, status: 'FROZEN' },
      update: { status: 'FROZEN' },
    });
    const pending = await calc.calculate(m.id);
    expect(pending).toMatchObject({ status: 'PENDING', reason: 'ATHLETE_NOT_ACTIVE', replayed: false });
    expect(await t.admin.ratingHistory.count({ where: { matchId: m.id } })).toBe(0);
    await t.admin.athleteRating.update({ where: { athleteId: red }, data: { status: 'ACTIVE' } });
    const done = await calc.calculate(m.id);
    expect(done).toMatchObject({ calculationId: pending.calculationId, status: 'COMPLETED', reason: null });
    expect(await t.admin.ratingHistory.count({ where: { matchId: m.id } })).toBe(2);
  });

  /** Две схватки без результата с общим спортсменом: [раньше, позже, общий спортсмен]. */
  const freePair = async (): Promise<[ScheduledMatch, ScheduledMatch, string]> => {
    const taken = new Set(
      (await t.admin.matchResult.findMany({ select: { matchId: true } })).map((r) => r.matchId),
    );
    const open = matches.filter((x) => !taken.has(x.id));
    for (const a of open)
      for (const b of open) {
        if (a === b) continue;
        const ids = new Set([await athleteOf(a, 'RED'), await athleteOf(a, 'BLUE')]);
        for (const side of ['RED', 'BLUE'] as const) {
          const shared = await athleteOf(b, side);
          if (ids.has(shared)) return [a, b, shared];
        }
      }
    throw new Error('no pair of open matches with a shared athlete');
  };
  const historyOf = (calculationId: string) => t.admin.ratingHistory.findMany({ where: { calculationId } });

  it("rates an athlete's matches in order: a later match waits for the earlier one", async () => {
    const [early, late, shared] = await freePair();
    await setResult(early, { winnerSide: 'RED', method: 'POINTS' });
    await setResult(late, { winnerSide: 'BLUE', method: 'SUPERIORITY' });

    // Подтверждение более поздней схватки обработано первым — расчёт ждёт.
    const waiting = await calc.calculate(late.id);
    expect(waiting).toMatchObject({ status: 'PENDING', reason: 'EARLIER_MATCH_PENDING' });
    expect(await t.admin.ratingHistory.count({ where: { matchId: late.id } })).toBe(0);

    const first = await calc.calculate(early.id);
    expect(first.status).toBe('COMPLETED');
    const released = await calc.releasePending(first.athleteIds);
    expect(released).toEqual([
      expect.objectContaining({ calculationId: waiting.calculationId, status: 'COMPLETED' }),
    ]);
    // Вторая схватка начата от рейтинга после первой.
    const after = (await historyOf(first.calculationId!)).find((h) => h.athleteId === shared)!;
    const next = (await historyOf(waiting.calculationId!)).find((h) => h.athleteId === shared)!;
    expect(next.ratingBefore).toBe(after.ratingAfter);
    expect((await ratingOf(shared))?.rating).toBe(next.ratingAfter);
  });

  it('turns an amended result into a correction without rewriting history', async () => {
    const m = await free();
    await setResult(m, { winnerSide: 'RED', method: 'TOTAL_VICTORY' });
    const red = await athleteOf(m, 'RED');
    const blue = await athleteOf(m, 'BLUE');
    const first = await calc.calculate(m.id);
    expect(first.status).toBe('COMPLETED');
    const [redBefore, blueBefore] = [(await ratingOf(red))!, (await ratingOf(blue))!];
    const oldRows = await historyOf(first.calculationId!);
    const old = (id: string) => oldRows.find((h) => h.athleteId === id)!;

    // Результат изменён: победил синий по баллам.
    await t.admin.matchResult.update({
      where: { matchId: m.id },
      data: { status: 'AMENDED', winnerSide: 'BLUE', method: 'POINTS', methodDetail: null, revision: 2 },
    });
    const amended = await calc.calculate(m.id);
    expect(amended).toMatchObject({ status: 'COMPLETED', replayed: false });
    expect(amended.calculationId).not.toBe(first.calculationId);
    expect(
      (await t.admin.ratingCalculation.findUniqueOrThrow({ where: { id: first.calculationId! } })).status,
    ).toBe('SUPERSEDED');
    // Прежняя история на месте; новая — от тех же рейтингов до схватки.
    expect(await historyOf(first.calculationId!)).toHaveLength(2);
    const newRows = await historyOf(amended.calculationId!);
    const now = (id: string) => newRows.find((h) => h.athleteId === id)!;
    expect(now(red).ratingBefore).toBe(old(red).ratingBefore);
    expect(now(blue).ratingBefore).toBe(old(blue).ratingBefore);
    expect(now(blue).outcome).toBe('WIN_ON_POINTS');
    expect(now(red).outcome).toBe('LOSS_ON_POINTS');
    // Текущий рейтинг получил разницу к начисленному; победа и поражение поменялись местами.
    for (const [id, was] of [
      [red, redBefore],
      [blue, blueBefore],
    ] as const) {
      const correction = now(id).ratingDelta - old(id).ratingDelta;
      const r = (await ratingOf(id))!;
      expect(r.rating).toBe(was.rating + correction);
      expect(r.ratedMatches).toBe(was.ratedMatches);
      const c = await t.admin.ratingCorrection.findFirstOrThrow({
        where: { athleteId: id, calculationId: amended.calculationId! },
      });
      expect(c).toMatchObject({
        kind: 'RESULT_AMENDED',
        supersededCalculationId: first.calculationId,
        ratingBefore: was.rating,
        ratingAfter: was.rating + correction,
        delta: correction,
      });
    }
    expect((await ratingOf(red))!.wins).toBe(redBefore.wins - 1);
    expect((await ratingOf(blue))!.wins).toBe(blueBefore.wins + 1);
    expect(
      await t.admin.auditLog.count({ where: { action: 'rating.amended', entityId: amended.calculationId! } }),
    ).toBe(1);
    // Повтор — без второй корректировки.
    expect(await calc.calculate(m.id)).toMatchObject({
      calculationId: amended.calculationId,
      replayed: true,
    });
    expect(await t.admin.ratingCorrection.count({ where: { calculationId: amended.calculationId! } })).toBe(
      2,
    );

    // Изменён ещё раз — неявка обоих, схватка не рейтинговая: начисленное снимается полностью.
    await t.admin.matchResult.update({
      where: { matchId: m.id },
      data: { winnerSide: null, method: 'NO_SHOW', revision: 3 },
    });
    expect(await calc.calculate(m.id)).toMatchObject({ status: 'SKIPPED', reason: 'NO_WINNER' });
    for (const [id, was] of [
      [red, redBefore],
      [blue, blueBefore],
    ] as const) {
      const r = (await ratingOf(id))!;
      expect(r.rating).toBe(was.rating - old(id).ratingDelta);
      expect(r.ratedMatches).toBe(was.ratedMatches - 1);
    }
  });

  it('writes nothing for a match of a competition that is not rated', async () => {
    const m = await free();
    await setResult(m, { winnerSide: 'RED', method: 'POINTS' });
    // После расчётов тип турнира не меняется (триггер, фаза 8); здесь проверяется собственная проверка расчёта.
    await t.admin.$executeRaw`ALTER TABLE competition DISABLE TRIGGER competition_type_guard`;
    await t.admin.competition.update({
      where: { id: w.competitionId },
      data: { competitionType: 'NON_RATED' },
    });
    try {
      expect(await calc.calculate(m.id)).toMatchObject({ calculationId: null, reason: 'NOT_RATED' });
      expect(await t.admin.ratingCalculation.count({ where: { matchId: m.id } })).toBe(0);
    } finally {
      await t.admin.competition.update({
        where: { id: w.competitionId },
        data: { competitionType: 'RATED' },
      });
      await t.admin.$executeRaw`ALTER TABLE competition ENABLE TRIGGER competition_type_guard`;
    }
    expect((await calc.calculate(m.id)).status).toBe('COMPLETED');
  });

  it('gives the application no way to rewrite or delete history', async () => {
    const db = t.app.get(PrismaService);
    await expect(db.$executeRaw`UPDATE rating_history SET rating_after = rating_after + 1`).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.$executeRaw`DELETE FROM rating_history`).rejects.toThrow(/permission denied/);
    await expect(db.$executeRaw`DELETE FROM athlete_rating`).rejects.toThrow(/permission denied/);
    await expect(db.$executeRaw`UPDATE rating_correction SET delta = 0`).rejects.toThrow(/permission denied/);
  });
});
