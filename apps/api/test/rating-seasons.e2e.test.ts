// Сезоны рейтинга (ТЗ 68; фаза 15): заводит администратор платформы (только с правом управлять правилами рейтинга),
// сезоны не пересекаются; сезонная таблица — представление единого рейтинга за период (Elo не сбрасывается):
// спортсмены со схватками сезона по рейтингу на конец сезона; сезоны в карточке спортсмена.
import type {
  Page,
  PublicAthleteSeason,
  PublicRankingRow,
  PublicRatingSeason,
  RatingSeason,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
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
let matches: ScheduledMatch[];

const api = '/api/v1/admin/rating/seasons';
const year = new Date().getUTCFullYear();
const previous = {
  code: `${year - 1}a`,
  name: 'Первая половина',
  startsOn: `${year - 1}-01-01`,
  endsOn: `${year - 1}-06-30`,
};
const current = {
  code: `${year}`,
  name: `Сезон ${year}`,
  startsOn: `${year - 1}-07-01`,
  endsOn: `${year + 1}-12-31`,
};
const future = {
  code: `${year + 2}`,
  name: 'Будущий',
  startsOn: `${year + 2}-01-01`,
  endsOn: `${year + 2}-12-31`,
};

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  superAdmin = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
  platformAdmin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, {
    totp: true,
  });
  w = await refereeWorld(t, [{ admitted: 4, format: 'ROUND_ROBIN' }]);
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
  expect(matches).toHaveLength(6);
});
afterAll(async () => {
  await t.close();
});

const get = <T>(url: string, query: Record<string, string> = {}) =>
  t
    .http()
    .get(`/api/public/v1${url}`)
    .query(query)
    .then((r) => ({ status: r.status, body: r.body as T }));

const athleteOf = async (m: ScheduledMatch, side: 'RED' | 'BLUE'): Promise<string> =>
  (
    await t.admin.entry.findUniqueOrThrow({
      where: { id: m.participants.find((p) => p.side === side)!.entryId! },
    })
  ).athleteId;
const sides = async (m: ScheduledMatch) => ({
  RED: await athleteOf(m, 'RED'),
  BLUE: await athleteOf(m, 'BLUE'),
});

/** Подтверждённый результат и время окончания схватки; затем расчёт. */
async function play(m: ScheduledMatch, winnerSide: 'RED' | 'BLUE', at: Date): Promise<void> {
  await t.admin.matchResult.create({
    data: {
      id: uuidv7(),
      competitionId: m.competitionId,
      matchId: m.id,
      status: 'CONFIRMED',
      winnerSide,
      method: 'POINTS',
      methodDetail: null,
      revision: 1,
      confirmedAt: at,
      confirmedById: w.refs.chief1.id,
    },
  });
  await t.admin.match.update({ where: { id: m.id }, data: { status: 'FINISHED', finishedAt: at } });
  expect((await t.app.get(RatingCalculationService).calculate(m.id)).status).toBe('COMPLETED');
}

async function allowPublication(athleteId: string): Promise<string> {
  const athlete = await t.admin.athleteProfile.findUniqueOrThrow({ where: { id: athleteId } });
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
      subjectPersonId: athlete.personId,
      givenByPersonId: athlete.personId,
      templateId: template.id,
      method: 'ELECTRONIC',
      givenAt: new Date(),
    },
  });
  return athlete.publicId;
}

const ratingOf = async (athleteId: string) =>
  (await t.admin.athleteRating.findUniqueOrThrow({ where: { athleteId } })).rating;

describe('rating seasons', () => {
  let currentId: string;

  it('lets only a super admin create a season; the platform admin sees them; the organizer gets 403', async () => {
    expect((await send(organizer, 'post', api, current)).status).toBe(403);
    expect((await organizer.agent.get(api)).status).toBe(403);
    expect((await send(platformAdmin, 'post', api, current)).status).toBe(403);
    const created = await send(superAdmin, 'post', api, current);
    expect(created.status).toBe(201);
    const season = (created.body as { data: RatingSeason }).data;
    expect(season).toMatchObject({ ...current, current: true });
    currentId = season.id;
    const list = await platformAdmin.agent.get(api);
    expect(list.status).toBe(200);
    expect((list.body as { data: RatingSeason[] }).data.map((s) => s.code)).toEqual([current.code]);
    const audit = await t.admin.auditLog.findFirstOrThrow({ where: { action: 'rating.season_created' } });
    expect(audit).toMatchObject({ entityId: season.id, platformIntervention: true });
  });

  it('rejects overlapping seasons, a taken code and reversed dates', async () => {
    const overlap = await send(superAdmin, 'post', api, {
      ...previous,
      endsOn: `${year - 1}-07-01`,
    });
    expect(overlap.status).toBe(422);
    expect((overlap.body as { error: { code: string } }).error.code).toBe('RATING_SEASON_OVERLAP');
    const taken = await send(superAdmin, 'post', api, { ...future, code: current.code });
    expect(taken.status).toBe(409);
    expect((await send(superAdmin, 'post', api, { ...future, endsOn: `${year + 1}-12-31` })).status).toBe(
      400,
    );
    expect((await send(superAdmin, 'post', api, previous)).status).toBe(201);
    expect((await send(superAdmin, 'post', api, future)).status).toBe(201);
    // Изменение сезона тоже не может наложиться на соседний.
    const moved = await send(superAdmin, 'put', `${api}/${currentId}`, {
      ...current,
      startsOn: `${year - 1}-06-30`,
    });
    expect(moved.status).toBe(422);
    const renamed = await send(superAdmin, 'put', `${api}/${currentId}`, {
      ...current,
      name: 'Основной сезон',
    });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { data: RatingSeason }).data.name).toBe('Основной сезон');
    current.name = 'Основной сезон';
    expect(await t.admin.auditLog.count({ where: { action: 'rating.season_updated' } })).toBe(1);
    expect((await send(platformAdmin, 'put', `${api}/${currentId}`, current)).status).toBe(403);
  });

  it('builds a season table from the shared rating without resetting Elo', async () => {
    // Сезон 1: A побеждает B. Текущий сезон: C побеждает A, C побеждает D; у B — только корректировка.
    const m1 = matches[0]!;
    const { RED: a, BLUE: b } = await sides(m1);
    let m2: ScheduledMatch | undefined;
    let c = '';
    for (const m of matches) {
      const s = await sides(m);
      if ((s.RED === a || s.BLUE === a) && s.RED !== b && s.BLUE !== b) {
        m2 = m;
        c = s.RED === a ? s.BLUE : s.RED;
        break;
      }
    }
    let m3: ScheduledMatch | undefined;
    let d = '';
    for (const m of matches) {
      const s = await sides(m);
      if ((s.RED === c || s.BLUE === c) && ![a, b].includes(s.RED) && ![a, b].includes(s.BLUE)) {
        m3 = m;
        d = s.RED === c ? s.BLUE : s.RED;
        break;
      }
    }
    expect(m2 && m3).toBeTruthy();
    await play(
      m1,
      (await athleteOf(m1, 'RED')) === a ? 'RED' : 'BLUE',
      new Date(`${year - 1}-03-01T10:00:00Z`),
    );
    await play(
      m2!,
      (await athleteOf(m2!, 'RED')) === c ? 'RED' : 'BLUE',
      new Date(Date.now() - 2 * 3600_000),
    );
    await play(m3!, (await athleteOf(m3!, 'RED')) === c ? 'RED' : 'BLUE', new Date(Date.now() - 3600_000));
    const bRating = await ratingOf(b);
    await t.admin.ratingCorrection.create({
      data: {
        athleteId: b,
        kind: 'MANUAL',
        ratingBefore: bRating,
        ratingAfter: bRating + 5,
        delta: 5,
        reason: 'Проверка',
        createdById: (await t.admin.user.findFirstOrThrow()).id,
      },
    });
    await t.admin.athleteRating.update({ where: { athleteId: b }, data: { rating: bRating + 5 } });
    const publicA = await allowPublication(a);
    for (const x of [b, c, d]) await allowPublication(x);

    // Будущий сезон на сайте не виден; текущий отмечен.
    const seasons = await get<{ data: PublicRatingSeason[] }>('/rating-seasons');
    expect(seasons.status).toBe(200);
    expect(seasons.body.data.map((s) => [s.code, s.current])).toEqual([
      [current.code, true],
      [previous.code, false],
    ]);
    expect((await get('/rankings', { season: future.code })).status).toBe(404);
    expect((await get('/rankings', { season: 'nope' })).status).toBe(404);
    expect((await get('/rankings', { season: 'не код' })).status).toBe(400);

    const past = await get<Page<PublicRankingRow>>('/rankings', { season: previous.code });
    expect(past.status).toBe(200);
    expect(
      past.body.data.map((r) => [r.rank, r.rating, r.season, r.ratedMatches, r.wins, r.losses, r.rankChange]),
    ).toEqual([
      [1, 212, { ratingStart: 200, delta: 12 }, 1, 1, 0, null],
      [2, 188, { ratingStart: 200, delta: -12 }, 1, 0, 1, null],
    ]);

    // Текущий сезон: рейтинг на конец — текущий (Elo продолжается с прошлого сезона); B без схваток — не в таблице.
    const now = await get<Page<PublicRankingRow>>('/rankings', { season: current.code });
    const rows = now.body.data;
    expect(rows).toHaveLength(3);
    const expected = await Promise.all([c, a, d].map(ratingOf));
    expect(rows.map((r) => r.rating)).toEqual([...expected].sort((x, y) => y - x));
    const rowA = rows.find((r) => r.athlete.publicId === publicA)!;
    expect(rowA).toMatchObject({
      rating: await ratingOf(a),
      season: { ratingStart: 212, delta: (await ratingOf(a)) - 212 },
      ratedMatches: 1,
      wins: 0,
      losses: 1,
    });
    // Общая таблица не меняется: B со своей корректировкой в ней есть, место — по текущему рейтингу.
    const overall = await get<Page<PublicRankingRow>>('/rankings');
    expect(overall.body.data).toHaveLength(4);
    expect(overall.body.data.every((r) => r.season === null)).toBe(true);

    // Сезоны в карточке спортсмена A, новые сверху.
    const card = await get<{ data: PublicAthleteSeason[] }>(`/athletes/${publicA}/rating-seasons`);
    expect(card.status).toBe(200);
    expect(card.body.data).toEqual([
      {
        season: { ...current, current: true },
        rank: rowA.rank,
        ratingStart: 212,
        ratingEnd: await ratingOf(a),
        delta: (await ratingOf(a)) - 212,
        matches: 1,
        wins: 0,
        losses: 1,
      },
      {
        season: { ...previous, current: false },
        rank: 1,
        ratingStart: 200,
        ratingEnd: 212,
        delta: 12,
        matches: 1,
        wins: 1,
        losses: 0,
      },
    ]);
  });
});
