// Публичная таблица рейтинга (фаза 7, docs/RATING_ARCHITECTURE.md, 8): место (равный рейтинг — одно место), фильтры
// только сужают список, курсор, изменение места по ежедневному снимку, имя — только при согласии на распространение
// ПДн (ADR-15); карточка и история спортсмена.
import type { Page, PublicAthleteRating, PublicRankingRow, PublicRatingHistoryItem } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { snapshotRanks } from '@sde/rating';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RatingCalculationService, RatingRulesService } from '../src/modules/rating';
import { createOrg, createTestApp, resetData, type TestApp } from './helpers/app';
import { clubAthlete } from './helpers/phase4';
import { confirm, playToResult, refereeWorld, scheduledMatches } from './helpers/phase7';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

const year = new Date().getUTCFullYear();

/** Общее согласие человека на распространение ПДн. */
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

const get = <T>(url: string, query: Record<string, string> = {}) =>
  t
    .http()
    .get(`/api/public/v1${url}`)
    .query(query)
    .then((r) => ({ status: r.status, body: r.body as T, headers: r.headers }));

describe('public rankings', () => {
  const ids: Record<string, { athleteId: string; personId: string; publicId: string }> = {};
  let clubA: string;
  let clubB: string;

  beforeAll(async () => {
    clubA = await createOrg(t);
    clubB = await createOrg(t);
    // Рейтинг, пол, год рождения, клуб, согласие.
    const roster: [string, number, 'MALE' | 'FEMALE', number, string, boolean, Record<string, unknown>?][] = [
      ['top', 260, 'MALE', year - 20, clubA, true],
      ['tieA', 230, 'FEMALE', year - 16, clubB, true],
      ['tieB', 230, 'MALE', year - 30, clubA, false],
      ['low', 150, 'FEMALE', year - 12, clubB, true],
      ['frozen', 400, 'MALE', year - 25, clubA, true, { status: 'FROZEN' }],
      ['unrated', 200, 'MALE', year - 25, clubA, true, { ratedMatches: 0, wins: 0, losses: 0 }],
    ];
    for (const [key, rating, gender, birthYear, clubId, consent, over] of roster) {
      const a = await clubAthlete(t, {
        clubId,
        gender,
        birthDate: `${birthYear}-06-01`,
        lastName: `Рейтингов${key}`,
      });
      if (consent) await allowPublication(a.personId);
      await t.admin.athleteRating.create({
        data: {
          athleteId: a.athleteId,
          rating,
          peakRating: rating + 10,
          lowestRating: rating - 10,
          ratedMatches: 3,
          wins: 2,
          losses: 1,
          ...over,
        },
      });
      const { publicId } = await t.admin.athleteProfile.findUniqueOrThrow({ where: { id: a.athleteId } });
      ids[key] = { ...a, publicId };
    }
  });

  it('ranks active rated athletes; equal ratings share a place; names only with consent', async () => {
    const r = await get<Page<PublicRankingRow>>('/rankings');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(r.body.data.map((x) => [x.rank, x.rating])).toEqual([
      [1, 260],
      [2, 230],
      [2, 230],
      [4, 150],
    ]);
    const top = r.body.data[0]!;
    expect(top).toMatchObject({
      rankChange: null,
      athlete: { publicId: ids.top!.publicId, name: 'Рейтинговtop И.', hidden: false },
      peakRating: 270,
      ratedMatches: 3,
      wins: 2,
      losses: 1,
    });
    expect(top.level).toBeGreaterThanOrEqual(1);
    const hidden = r.body.data.find((x) => x.athlete.hidden)!;
    expect(hidden.athlete).toMatchObject({ publicId: null, name: null, hidden: true });
    expect(hidden.athlete.club).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/Рейтинговtie[B]|birth|personId|athleteId/);
  });

  it('filters narrow the list but keep the overall place', async () => {
    const women = await get<Page<PublicRankingRow>>('/rankings', { gender: 'FEMALE' });
    expect(women.body.data.map((x) => [x.rank, x.athlete.publicId])).toEqual([
      [2, ids.tieA!.publicId],
      [4, ids.low!.publicId],
    ]);
    const teens = await get<Page<PublicRankingRow>>('/rankings', { ageFrom: '12', ageTo: '16' });
    expect(teens.body.data.map((x) => x.rating)).toEqual([230, 150]);
    const adults = await get<Page<PublicRankingRow>>('/rankings', { ageFrom: '20' });
    expect(adults.body.data.map((x) => x.rating)).toEqual([260, 230]);
    const club = await get<Page<PublicRankingRow>>('/rankings', { clubId: clubB });
    expect(club.body.data.map((x) => x.rank)).toEqual([2, 4]);
    expect((await get('/rankings', { ageFrom: '30', ageTo: '20' })).status).toBe(400);
    expect((await get('/rankings', { clubId: 'nope' })).status).toBe(400);
  });

  it('pages with a cursor through equal ratings without gaps or repeats', async () => {
    const seen: (string | null)[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 4; i++) {
      const r = await get<Page<PublicRankingRow>>('/rankings', { limit: '1', ...(cursor ? { cursor } : {}) });
      expect(r.status).toBe(200);
      seen.push(...r.body.data.map((x) => `${x.rank}:${x.rating}:${x.athlete.club}`));
      cursor = r.body.page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(seen.map((s) => s!.split(':')[0])).toEqual(['1', '2', '2', '4']);
  });

  it('shows the change of place since the latest daily snapshot', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    expect(await t.admin.$transaction((tx) => snapshotRanks(tx, yesterday))).toBe(4);
    // Повтор в тот же день ничего не меняет.
    expect(await t.admin.$transaction((tx) => snapshotRanks(tx, yesterday))).toBe(0);
    await t.admin.athleteRating.update({
      where: { athleteId: ids.low!.athleteId },
      data: { rating: 300, peakRating: 300 },
    });
    const r = await get<Page<PublicRankingRow>>('/rankings');
    expect(r.body.data.map((x) => [x.rank, x.rankChange])).toEqual([
      [1, 3],
      [2, -1],
      [3, -1],
      [3, -1],
    ]);
    await t.admin.athleteRating.update({
      where: { athleteId: ids.low!.athleteId },
      data: { rating: 150, peakRating: 160 },
    });
  });

  it('opens the card only of athletes who allowed publication', async () => {
    const r = await get<{ data: PublicAthleteRating }>(`/rankings/${ids.tieA!.publicId}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      rank: 2,
      rating: 230,
      lowestRating: 220,
      athlete: { name: 'РейтинговtieA И.', hidden: false },
    });
    expect((await get(`/rankings/${ids.tieB!.publicId}`)).status).toBe(404);
    expect((await get(`/athletes/${ids.tieB!.publicId}/rating-history`)).status).toBe(404);
    expect((await get(`/rankings/${ids.frozen!.publicId}`)).status).toBe(404);
    // Неверный идентификатор — как несуществующий.
    expect((await get('/rankings/ab')).status).toBe(404);
    const empty = await get<Page<PublicRatingHistoryItem>>(`/athletes/${ids.tieA!.publicId}/rating-history`);
    expect(empty.body).toEqual({ data: [], page: { nextCursor: null, hasMore: false } });
  });
});

describe('public rating history', () => {
  it('lists rated matches with the competition and the opponent, hidden without consent', async () => {
    await resetData(t);
    const w = await refereeWorld(t, [{ admitted: 2, format: 'SINGLE_ELIMINATION' }]);
    const rules = t.app.get(RatingRulesService);
    await t.admin.competition.update({ where: { id: w.competitionId }, data: { competitionType: 'RATED' } });
    await t.admin.competitionRatingConfig.create({
      data: { competitionId: w.competitionId, ruleSetId: (await rules.active())!.id },
    });
    const [m] = (await scheduledMatches(t, w.categories[0]!.categoryId)).filter((x) =>
      x.participants.every((p) => p.entryId && !p.isBye),
    );
    const played = await playToResult(w.refs.chief1.s, m!.id, 'RED');
    expect((await confirm(w.refs.chief1.s, played)).status).toBe(200);
    expect(await t.app.get(RatingCalculationService).calculate(m!.id)).toMatchObject({ status: 'COMPLETED' });

    const entryOf = (side: 'RED' | 'BLUE') =>
      t.admin.entry.findUniqueOrThrow({
        where: { id: m!.participants.find((p) => p.side === side)!.entryId! },
        include: { athlete: true },
      });
    const red = await entryOf('RED');
    await allowPublication(red.athlete.personId);
    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });

    const r = await get<Page<PublicRatingHistoryItem>>(`/athletes/${red.athlete.publicId}/rating-history`);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({
      kind: 'MATCH',
      ratingBefore: 200,
      ratingAfter: 212,
      delta: 12,
      outcome: 'WIN_ON_POINTS',
      competition: { slug: competition.slug, name: competition.name },
      opponent: { publicId: null, name: null, hidden: true, ratingBefore: 200 },
    });
    const card = await get<{ data: PublicAthleteRating }>(`/rankings/${red.athlete.publicId}`);
    expect(card.body.data).toMatchObject({ rank: 1, rating: 212, ratedMatches: 1, wins: 1, losses: 0 });

    // Черновик турнира не раскрывается в истории.
    await t.admin.competition.update({ where: { id: w.competitionId }, data: { status: 'DRAFT' } });
    const hidden = await get<Page<PublicRatingHistoryItem>>(
      `/athletes/${red.athlete.publicId}/rating-history`,
    );
    expect(hidden.body.data[0]!.competition).toBeNull();
  });
});
