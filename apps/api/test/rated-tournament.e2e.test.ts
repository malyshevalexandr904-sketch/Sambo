// Сквозной сценарий рейтингового турнира (ТЗ 75, фаза 16; ТЗ 76, п. 29): платформа делает турнир рейтинговым,
// жеребьёвка сеет по рейтингу в подгруппы, судьи проводят все схватки подгрупп и финальной части, после каждого
// подтверждения результат по событию outbox считается так же, как в worker (@sde/rating, роль приложения), места
// берутся из финальной части; Elo, история, уровни, пересборка, публичные страницы и аудит сходятся. Нерейтинговый
// турнир того же вида Elo не трогает.
import type {
  AthleteRatingProgress,
  BracketViewDto,
  CategoryBracketDto,
  CategoryResultsDto,
  Page,
  PublicAthleteRating,
  PublicCompetitionRatingSummary,
  PublicRankingRow,
  RatingRebuildReport,
} from '@sde/contracts';
import { createPrismaClient, type PrismaClient, uuidv7 } from '@sde/db';
import { ratingLevel, RatingCalculator, SAMBO_ELO_V1, systemSink } from '@sde/rating';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, login, resetData, type Session, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import { confirm, playToResult, type RefereeWorld, refereeWorld, scheduledMatches } from './helpers/phase7';
import { TEST_ENV } from './test-env';

let t: TestApp;
/** Подключение worker: роль приложения, как в apps/worker. */
let workerDb: PrismaClient;
let superAdmin: Session;
let platformAdmin: Session;

const HEAVY = 120_000;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  workerDb = createPrismaClient({ url: TEST_ENV.DATABASE_URL });
  superAdmin = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
  platformAdmin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, {
    totp: true,
  });
});
afterAll(async () => {
  await workerDb.$disconnect();
  await t.close();
});

const reason = 'Решение комиссии платформы о рейтинговом турнире';

/**
 * Потребитель рейтинга worker на событиях outbox: подтверждённый результат → расчёт, затем отпускаются ожидавшие.
 * Каждое событие — один раз (как ProcessedEvent у worker); возвращает число обработанных событий.
 */
const processed = new Set<string>();
async function drainRatingEvents(): Promise<number> {
  const calculator = new RatingCalculator((fn) => workerDb.$transaction(fn), systemSink('e2e'));
  const events = await t.admin.outboxEvent.findMany({
    where: { type: { in: ['match.result_confirmed', 'match.result_amended'] } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  let n = 0;
  for (const e of events.filter((x) => !processed.has(x.id))) {
    const { matchId } = e.payload as { matchId: string };
    const outcome = await calculator.calculate(matchId);
    if (outcome.status && outcome.status !== 'PENDING') await calculator.releasePending(outcome.athleteIds);
    processed.add(e.id);
    n++;
  }
  return n;
}

const pub = <T>(url: string) =>
  t
    .http()
    .get(`/api/public/v1${url}`)
    .then((r) => ({ status: r.status, body: r.body as T }));

async function allowPublication(personId: string): Promise<void> {
  const template =
    (await t.admin.consentTemplate.findFirst({
      where: { kind: 'PD_DISTRIBUTION', publishedAt: { not: null } },
    })) ??
    (await t.admin.consentTemplate.create({
      data: {
        id: uuidv7(),
        kind: 'PD_DISTRIBUTION',
        version: 1,
        locale: 'ru',
        operatorName: 'Оператор',
        bodyMarkdown: 'Согласие на распространение',
        publishedAt: new Date(),
      },
    }));
  await t.admin.consent.create({
    data: {
      id: uuidv7(),
      subjectPersonId: personId,
      givenByPersonId: personId,
      templateId: template.id,
      method: 'ELECTRONIC',
      givenAt: new Date(),
    },
  });
}

describe('rated tournament end to end', { timeout: HEAVY }, () => {
  let w: RefereeWorld;
  let categoryId: string;
  /** Номер посева участия. */
  let seed: Map<string, number>;
  /** Спортсмен участия. */
  let athleteOf: Map<string, string>;
  let played = 0;

  const view = async (): Promise<BracketViewDto> => {
    const r = await w.staff.chief.agent.get(`/api/v1/categories/${categoryId}/brackets`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body.data as CategoryBracketDto).bracket!;
  };

  /**
   * Готовые схватки судит главный судья, после каждого подтверждения — расчёт рейтинга по событию. Побеждает меньший
   * номер посева, кроме схватки посевов 1 и 4 (в подгруппе A змейкой): её выигрывает 4.
   */
  async function playReady(): Promise<number> {
    const ready = (await scheduledMatches(t, categoryId)).filter(
      (m) => !m.result && m.participants.length === 2 && m.participants.every((p) => p.entryId && !p.isBye),
    );
    for (const m of ready) {
      const red = seed.get(m.participants.find((p) => p.side === 'RED')!.entryId!)!;
      const blue = seed.get(m.participants.find((p) => p.side === 'BLUE')!.entryId!)!;
      const upset = Math.min(red, blue) === 1 && Math.max(red, blue) === 4;
      const redWins = upset ? red === 4 : red < blue;
      const result = await playToResult(w.staff.chief, m.id, redWins ? 'RED' : 'BLUE');
      const c = await confirm(w.staff.chief, result);
      expect(c.status, JSON.stringify(c.body)).toBe(200);
      expect(await drainRatingEvents()).toBe(1);
      played++;
    }
    return ready.length;
  }

  it('only the platform makes the tournament rated; the tournament staff gets 403', async () => {
    w = await refereeWorld(t, [{ admitted: 8 }], async (world) => {
      const url = `/api/v1/admin/competitions/${world.competitionId}/rating-type-change`;
      const body = { competitionType: 'RATED', reason };
      for (const s of [world.staff.manager, world.staff.chief, world.staff.secretary])
        expect((await send(s, 'post', url, body)).status).toBe(403);
      const r = await send(platformAdmin, 'post', url, body);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toMatchObject({
        competitionType: 'RATED',
        rating: { ruleSet: { calculationVersion: 'sambo-elo@1/elo-1' } },
      });
    });
    categoryId = w.categories[0]!.categoryId;
    const audit = await t.admin.auditLog.findFirstOrThrow({
      where: { action: 'competition.type_changed', competitionId: w.competitionId },
    });
    expect(audit).toMatchObject({ reason, platformIntervention: true });
  });

  it('draws two groups of four by the rating at the draw and keeps the seed', async () => {
    const b = await view();
    expect(b.format).toBe('SPECIAL_GROUP_RATED');
    seed = new Map(b.participants.map((p) => [p.entryId, p.seedNumber!]));
    expect([...seed.values()].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(b.groups!.standings.map((g) => [g.group, g.rows.length])).toEqual([
      ['A', 4],
      ['B', 4],
    ]);
    // Змейка по посеву: A — 1, 4, 5, 8; B — 2, 3, 6, 7.
    expect(
      b.groups!.standings.map((g) => g.rows.map((r) => seed.get(r.entryId)).sort((x, y) => x! - y!)),
    ).toEqual([
      [1, 4, 5, 8],
      [2, 3, 6, 7],
    ]);
    const seeds = await t.admin.tournamentSeed.findMany({ where: { competitionId: w.competitionId } });
    expect(seeds).toHaveLength(8);
    // Рейтинга ещё нет ни у кого — посев по начальному рейтингу версии правил.
    expect(seeds.every((s) => s.ratingAtDraw === SAMBO_ELO_V1.initialRating)).toBe(true);
    athleteOf = new Map(seeds.map((s) => [s.entryId, s.athleteId]));
    // Финальная часть ждёт мест подгрупп.
    expect(b.nodes.filter((n) => n.stage === 'FINAL').map((n) => n.label)).toEqual([
      'SEMIFINAL',
      'SEMIFINAL',
      'FINAL',
    ]);
  });

  it('plays the groups, fills the final part from the group places and plays it out', async () => {
    expect(await playReady()).toBe(12);
    const afterGroups = await view();
    expect(afterGroups.groups!.standings.every((g) => g.complete && !g.decisionRequired)).toBe(true);
    // A: 4 — 3 победы, 1 — 2, 5 — 1, 8 — 0; B: 2, 3, 6, 7. Полуфиналы A1–B2 и B1–A2.
    const finals = afterGroups.nodes.filter((n) => n.stage === 'FINAL');
    expect(
      finals.map((n) => [
        n.red.entryId && seed.get(n.red.entryId),
        n.blue.entryId && seed.get(n.blue.entryId),
      ]),
    ).toEqual([
      [4, 3],
      [2, 1],
      [null, null],
    ]);
    expect(await playReady()).toBe(2);
    expect(await playReady()).toBe(1);
    expect(await playReady()).toBe(0);
    expect(played).toBe(15);

    const r = await w.staff.chief.agent.get(`/api/v1/categories/${categoryId}/results`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const results = r.body.data as CategoryResultsDto;
    expect(
      results.placements
        .map((p) => [seed.get(p.entryId)!, p.place])
        .sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!),
    ).toEqual([
      [1, 1],
      [3, 2],
      [2, 3],
      [4, 3],
      [5, 5],
      [6, 5],
      [7, 7],
      [8, 7],
    ]);
  });

  it('rated every confirmed match exactly once; ratings, history and levels add up', async () => {
    const calcs = await t.admin.ratingCalculation.findMany({ where: { competitionId: w.competitionId } });
    expect(calcs).toHaveLength(15);
    expect(calcs.every((c) => c.status === 'COMPLETED')).toBe(true);
    // Повторное событие не начисляет второй раз.
    for (const e of [...processed]) processed.delete(e);
    expect(await drainRatingEvents()).toBe(15);
    expect(await t.admin.ratingCalculation.count({ where: { competitionId: w.competitionId } })).toBe(15);
    const history = await t.admin.ratingHistory.findMany({
      where: { competitionId: w.competitionId },
      orderBy: [{ matchFinishedAt: 'asc' }, { id: 'asc' }],
    });
    expect(history).toHaveLength(30);

    for (const athleteId of athleteOf.values()) {
      const own = history.filter((h) => h.athleteId === athleteId);
      // Рейтинг до схватки — рейтинг после предыдущей; первая — от начального.
      let rating = SAMBO_ELO_V1.initialRating;
      for (const h of own) {
        expect(h.ratingBefore).toBe(rating);
        expect(h.ratingAfter - h.ratingBefore).toBe(h.ratingDelta);
        expect(h.levelAfter).toBe(ratingLevel(SAMBO_ELO_V1, h.ratingAfter));
        rating = h.ratingAfter;
      }
      const current = await t.admin.athleteRating.findUniqueOrThrow({ where: { athleteId } });
      expect(current).toMatchObject({
        rating,
        ratedMatches: own.length,
        wins: own.filter((h) => Number(h.actualScore) > 0.5).length,
        losses: own.filter((h) => Number(h.actualScore) < 0.5).length,
        peakRating: Math.max(SAMBO_ELO_V1.initialRating, ...own.map((h) => h.ratingAfter)),
      });
    }
    // Сторона схватки — зеркало другой: рейтинг соперника до схватки записан у обоих.
    for (const c of calcs) {
      const [a, b] = history.filter((h) => h.calculationId === c.id);
      expect(a!.opponentRatingBefore).toBe(b!.ratingBefore);
      expect(b!.opponentRatingBefore).toBe(a!.ratingBefore);
      expect(Math.sign(a!.ratingDelta)).toBe(-Math.sign(b!.ratingDelta));
    }
    // Победитель турнира (посев 1, четыре победы из пяти) — в плюсе.
    const champion = [...seed.entries()].find(([, s]) => s === 1)![0];
    const championRating = await t.admin.athleteRating.findUniqueOrThrow({
      where: { athleteId: athleteOf.get(champion)! },
    });
    expect(championRating.rating).toBeGreaterThan(SAMBO_ELO_V1.initialRating);
    expect(
      await t.admin.auditLog.count({
        where: { action: 'rating.calculated', competitionId: w.competitionId },
      }),
    ).toBe(15);
  });

  it('rebuilds every rating from history without a discrepancy', async () => {
    for (const athleteId of athleteOf.values()) {
      const r = await send(platformAdmin, 'post', `/api/v1/admin/athletes/${athleteId}/rebuild-rating`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const report = r.body.data as RatingRebuildReport;
      expect(report.discrepancy).toBe(0);
      expect(report.steps.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("shows the athlete's division and the Elo tracker bout by bout in the cabinet (docs/RATED_ONLY.md)", async () => {
    const championEntry = [...seed.entries()].find(([, s]) => s === 1)![0];
    const athleteId = athleteOf.get(championEntry)!;
    const athlete = await t.admin.athleteProfile.findUniqueOrThrow({
      where: { id: athleteId },
      include: { person: true },
    });
    const age = new Date().getUTCFullYear() - athlete.person.birthDate.getUTCFullYear();
    // Дивизионы задаёт администратор: возраст спортсмена — внутри «своего», соседние не пересекаются.
    for (const [name, minAge, maxAge] of [
      ['Младший', null, age - 1],
      ['Основной', age, age + 1],
      ['Старший', age + 2, null],
    ] as const)
      expect(
        (await send(platformAdmin, 'post', '/api/v1/admin/divisions', { name, minAge, maxAge })).status,
      ).toBe(201);

    const r = await platformAdmin.agent.get(`/api/v1/athletes/${athleteId}/rating-progress`).expect(200);
    const p = r.body.data as AthleteRatingProgress;
    expect(p.division).toMatchObject({ name: 'Основной', age, agePolicy: 'BY_BIRTH_YEAR' });
    const current = await t.admin.athleteRating.findUniqueOrThrow({ where: { athleteId } });
    expect(p.rating).toMatchObject({ rating: current.rating, ratedMatches: current.ratedMatches });
    // Трекер: схватки по порядку, рейтинг после одной — рейтинг до следующей; последняя точка — текущий рейтинг.
    const matches = p.bouts.filter((b) => b.kind === 'MATCH');
    expect(matches).toHaveLength(current.ratedMatches);
    expect(p.bouts[0]!.ratingBefore).toBe(SAMBO_ELO_V1.initialRating);
    for (let i = 1; i < p.bouts.length; i++)
      expect(p.bouts[i]!.ratingBefore).toBe(p.bouts[i - 1]!.ratingAfter);
    expect(p.bouts.at(-1)!.ratingAfter).toBe(current.rating);
    for (const b of matches) {
      expect(b.ratingAfter - b.ratingBefore).toBe(b.delta);
      expect(b.competition).not.toBeNull();
      expect(b.outcome).not.toBeNull();
    }

    // Чужой спортсмен — как отсутствующий.
    const stranger = await login(t, (await createUser(t)).email);
    await stranger.agent.get(`/api/v1/athletes/${athleteId}/rating-progress`).expect(404);
  });

  it('shows the tournament and the athletes publicly', async () => {
    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const summary = await pub<{ data: PublicCompetitionRatingSummary }>(
      `/competitions/${competition.slug}/rating-summary`,
    );
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect(summary.body.data.ratedMatches).toBe(15);
    expect(summary.body.data.athletes).toHaveLength(8);
    for (const row of summary.body.data.athletes) expect(row.ratingAfter - row.ratingBefore).toBe(row.delta);

    // Таблица рейтинга: восемь спортсменов; имя и карточка — у давшего согласие.
    const championEntry = [...seed.entries()].find(([, s]) => s === 1)![0];
    const champion = await t.admin.athleteProfile.findUniqueOrThrow({
      where: { id: athleteOf.get(championEntry)! },
    });
    await allowPublication(champion.personId);
    const table = await pub<Page<PublicRankingRow>>('/rankings');
    expect(table.body.data).toHaveLength(8);
    expect(table.body.data.filter((r) => !r.athlete.hidden).map((r) => r.athlete.publicId)).toEqual([
      champion.publicId,
    ]);
    const card = await pub<{ data: PublicAthleteRating }>(`/rankings/${champion.publicId}`);
    expect(card.status).toBe(200);
    const current = await t.admin.athleteRating.findUniqueOrThrow({ where: { athleteId: champion.id } });
    expect(card.body.data).toMatchObject({ rating: current.rating, ratedMatches: current.ratedMatches });
    const rated = await pub<{ data: { slug: string; delta: number }[] }>(
      `/athletes/${champion.publicId}/rated-competitions`,
    );
    expect(rated.body.data).toEqual([
      expect.objectContaining({ slug: competition.slug, delta: current.rating - SAMBO_ELO_V1.initialRating }),
    ]);
  });

  it('cannot make the tournament non-rated (and not at all once ratings exist)', async () => {
    const r = await send(
      superAdmin,
      'post',
      `/api/v1/admin/competitions/${w.competitionId}/rating-type-change`,
      { competitionType: 'NON_RATED', reason },
    );
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('NON_RATED_COMPETITION_FORBIDDEN');
  });

  it('a new formula applies to new tournaments only; earlier ratings stay as calculated', async () => {
    const history = () =>
      t.admin.ratingHistory.findMany({ where: { competitionId: w.competitionId }, orderBy: { id: 'asc' } });
    const before = await history();
    // Новая версия правил (другой код, чтобы не трогать действующую sambo-elo@1): K вдвое больше.
    // Версии правил не удаляются и не входят в очистку тестовых данных — код уникален на прогон.
    const ruleSetId = uuidv7();
    const code = `sambo-elo-e2e-${ruleSetId.slice(-8)}`;
    await t.admin.ratingRuleSet.create({
      data: {
        id: ruleSetId,
        code,
        version: 1,
        name: 'Проверка новой формулы',
        schemaVersion: 1,
        parameters: {
          ...SAMBO_ELO_V1,
          kFactorRules: SAMBO_ELO_V1.kFactorRules.map((r) => ({ ...r, k: r.k * 2 })),
        },
        checksum: 'e2e',
        engineVersion: 'elo-1',
        status: 'ACTIVE',
        activeFrom: new Date(),
      },
    });
    try {
      const next = await refereeWorld(t, [{ admitted: 3 }], async (world) => {
        await t.admin.competition.update({
          where: { id: world.competitionId },
          data: { competitionType: 'RATED' },
        });
        await t.admin.competitionRatingConfig.create({
          data: { competitionId: world.competitionId, ruleSetId },
        });
      });
      const [m] = (await scheduledMatches(t, next.categories[0]!.categoryId)).filter((x) =>
        x.participants.every((p) => p.entryId && !p.isBye),
      );
      const result = await playToResult(next.staff.chief, m!.id, 'RED');
      expect((await confirm(next.staff.chief, result)).status).toBe(200);
      expect(await drainRatingEvents()).toBe(1);
      // 200 / 200, победа по баллам: по sambo-elo@1 было бы +12, по новой версии — +24.
      const fresh = await t.admin.ratingHistory.findMany({ where: { competitionId: next.competitionId } });
      expect(fresh.map((h) => [h.ratingDelta, h.calculationVersion]).sort()).toEqual([
        [-24, `${code}@1/elo-1`],
        [24, `${code}@1/elo-1`],
      ]);
      // История турнира по прежней версии не изменилась, пересборка по-прежнему без расхождения.
      expect(await history()).toEqual(before);
      for (const athleteId of [...athleteOf.values()].slice(0, 2)) {
        const r = await send(platformAdmin, 'post', `/api/v1/admin/athletes/${athleteId}/rebuild-rating`);
        expect((r.body.data as RatingRebuildReport).discrepancy).toBe(0);
      }
    } finally {
      await t.admin.ratingRuleSet.update({
        where: { id: ruleSetId },
        data: { status: 'RETIRED', activeTo: new Date() },
      });
    }
  });

  it('a non-rated tournament of the same kind leaves Elo alone', async () => {
    const before = await t.admin.athleteRating.findMany({ orderBy: { athleteId: 'asc' } });
    const plain = await refereeWorld(t, [{ admitted: 4 }]);
    const id = plain.categories[0]!.categoryId;
    const matches = (await scheduledMatches(t, id)).filter((m) =>
      m.participants.every((p) => p.entryId && !p.isBye),
    );
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const result = await playToResult(plain.staff.chief, m.id, 'RED');
      expect((await confirm(plain.staff.chief, result)).status).toBe(200);
    }
    expect(await drainRatingEvents()).toBe(matches.length);
    expect(await t.admin.ratingCalculation.count({ where: { competitionId: plain.competitionId } })).toBe(0);
    expect(await t.admin.ratingHistory.count({ where: { competitionId: plain.competitionId } })).toBe(0);
    expect(await t.admin.athleteRating.findMany({ orderBy: { athleteId: 'asc' } })).toEqual(before);
  });
});
