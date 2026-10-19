// Формат рейтингового турнира (фазы 9–12, docs/RATED_TOURNAMENT_FORMAT.md): категория рейтингового турнира по
// умолчанию получает формат SPECIAL_GROUP_RATED и план подгрупп по числу допущенных; меньше 3 и больше 39 участников —
// ошибка формата. Жеребьёвка сеет по рейтингу на момент жеребьёвки, раскладывает подгруппы змейкой и сохраняет посев;
// публикация строит по сетке на каждую подгруппу. Таблицы подгрупп — по критериям версии формата (утверждены
// заказчиком, Q-F4); затем финальная часть по местам подгрупп. Нерейтинговый турнир выбирает формат по правилам, как раньше.
import type {
  BracketViewDto,
  CategoryBracketDto,
  CategoryDrawsDto,
  CategoryResultsDto,
  DrawDto,
} from '@sde/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import { type DrawWorld, drawCategory, drawWorld, SEED_A } from './helpers/phase5';
import { confirm, playToResult, refereeWorld, scheduledMatches } from './helpers/phase7';

let t: TestApp;
let rated: DrawWorld;
let plain: DrawWorld;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  rated = await drawWorld(t);
  await t.admin.competition.update({
    where: { id: rated.competitionId },
    data: { competitionType: 'RATED' },
  });
  plain = await drawWorld(t);
});
afterAll(async () => {
  await t.close();
});

async function draws(w: DrawWorld, categoryId: string): Promise<CategoryDrawsDto> {
  const r = await w.staff.manager.agent.get(`/api/v1/categories/${categoryId}/draws`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as CategoryDrawsDto;
}

describe('rated tournament format', () => {
  it('suggests the group format with the plan for the admitted participants', async () => {
    const cat = await drawCategory(t, rated, 13);
    const d = await draws(rated, cat.categoryId);
    expect(d.suggestedFormat).toBe('SPECIAL_GROUP_RATED');
    expect(d.ratedPlan).toEqual({
      ok: true,
      plan: {
        formatVersion: 'rated-groups-v1',
        participants: 13,
        groups: [
          { letter: 'A', size: 3, matches: 3 },
          { letter: 'B', size: 3, matches: 3 },
          { letter: 'C', size: 3, matches: 3 },
          { letter: 'D', size: 4, matches: 6 },
        ],
        qualifiersPerGroup: 2,
        finalBracketSize: 8,
        finalPairing: [
          ['A1', 'B2'],
          ['C1', 'D2'],
          ['B1', 'A2'],
          ['D1', 'C2'],
        ],
        groupMatches: 15,
        finalMatches: 7,
        totalMatches: 22,
      },
    });
  });

  it('rejects a draw with fewer participants than the format allows', async () => {
    const cat = await drawCategory(t, rated, 2);
    const d = await draws(rated, cat.categoryId);
    expect(d.ratedPlan).toEqual({
      ok: false,
      issue: 'INSUFFICIENT_PARTICIPANTS',
      minParticipants: 3,
      maxParticipants: 39,
    });
    const r = await send(rated.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {});
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'INSUFFICIENT_PARTICIPANTS',
      details: { admitted: 2, min: 3, max: 39 },
    });
  });

  it('rejects a draw with more participants than the format allows', async () => {
    const cat = await drawCategory(t, rated, 40);
    expect((await draws(rated, cat.categoryId)).ratedPlan).toMatchObject({
      ok: false,
      issue: 'TOO_MANY_PARTICIPANTS',
    });
    const r = await send(rated.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('TOO_MANY_PARTICIPANTS');
  });

  it('a category format override wins over the rated default', async () => {
    const cat = await drawCategory(t, rated, 4, { formatOverride: 'ROUND_ROBIN' });
    const d = await draws(rated, cat.categoryId);
    expect(d).toMatchObject({ suggestedFormat: 'ROUND_ROBIN', ratedPlan: null });
    const r = await send(rated.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('a non-rated competition keeps the format chosen by its rules', async () => {
    const cat = await drawCategory(t, plain, 4);
    expect(await draws(plain, cat.categoryId)).toMatchObject({
      suggestedFormat: 'ROUND_ROBIN',
      ratedPlan: null,
    });
  });
});

describe('rated group generation', () => {
  /** Рейтинг 300 − i у i-го участника (по имени Борцов00…), без рейтинга — последние `unrated`. */
  async function ratedCategory(n: number, unrated = 0) {
    const cat = await drawCategory(t, rated, n);
    const entries = await t.admin.entry.findMany({
      where: { id: { in: cat.entries } },
      select: { id: true, athleteId: true, snapLastName: true },
      orderBy: { snapLastName: 'asc' },
    });
    for (const [i, e] of entries.slice(0, n - unrated).entries()) {
      const rating = 300 - i * 5;
      await t.admin.athleteRating.create({
        data: { athleteId: e.athleteId, rating, peakRating: rating, lowestRating: rating },
      });
    }
    return { ...cat, ordered: entries.map((e) => e.id) };
  }

  const createDraft = (categoryId: string, body: Record<string, unknown> = {}) =>
    send(rated.staff.manager, 'post', `/api/v1/categories/${categoryId}/draws`, body);

  it('seeds by rating at the draw, fills groups snake-wise and keeps the seed', async () => {
    const cat = await ratedCategory(13, 2);
    const r = await createDraft(cat.categoryId, { randomSeed: SEED_A });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const draw = r.body.data as DrawDto;
    expect(draw).toMatchObject({ format: 'SPECIAL_GROUP_RATED', participants: 13 });
    expect(draw.separation).toMatchObject({ applicable: false, keys: [] });
    // Посев: рейтинг 300, 295, … — номера 1…11; двое без рейтинга — начальный 200, номера 12 и 13.
    const bySeed = [...draw.bracket.participants].sort((a, b) => a.seedNumber! - b.seedNumber!);
    expect(bySeed.slice(0, 11).map((p) => p.entryId)).toEqual(cat.ordered.slice(0, 11));
    expect(bySeed.map((p) => p.ratingAtDraw)).toEqual([
      ...Array.from({ length: 11 }, (_, i) => 300 - i * 5),
      200,
      200,
    ]);
    const groups: Record<string, number[]> = {};
    for (const s of draw.slots) (groups[s.pool!] ??= []).push(s.seedNumber!);
    expect(groups).toEqual({ A: [1, 8, 9], B: [2, 7, 10], C: [3, 6, 11], D: [4, 5, 12, 13] });
    // Предпросмотр — круги каждой подгруппы по схеме формата (15 схваток) и финальная часть (7).
    expect(draw.bracket.nodes).toHaveLength(22);
    expect(new Set(draw.bracket.nodes.map((n) => n.group))).toEqual(new Set(['A', 'B', 'C', 'D', null]));
    // Таблицы подгрупп до схваток: критерии версии формата утверждены, выход ещё не решён.
    expect(draw.bracket.groups).toMatchObject({
      criteria: ['WINS', 'HEAD_TO_HEAD', 'CLEAN_WINS', 'SUPERIORITY_WINS'],
      criteriaConfirmed: true,
      qualifiersPerGroup: 2,
    });
    expect(draw.bracket.groups!.standings.map((g) => [g.group, g.complete, g.rows.length])).toEqual([
      ['A', false, 3],
      ['B', false, 3],
      ['C', false, 3],
      ['D', false, 4],
    ]);
    expect(
      draw.bracket
        .groups!.standings.flatMap((g) => g.rows)
        .every((r) => r.matches === 0 && r.qualified === null),
    ).toBe(true);

    const seeds = await t.admin.tournamentSeed.findMany({ where: { drawId: draw.id } });
    expect(seeds).toHaveLength(13);
    const top = seeds.find((s) => s.seedNumber === 1)!;
    expect(top).toMatchObject({ entryId: cat.ordered[0], ratingAtDraw: 300 });
    const verify = await send(rated.staff.manager, 'post', `/api/v1/draws/${draw.id}/verify`, {});
    expect(verify.body.data).toMatchObject({ reproducible: true, currentInput: true });

    // Рейтинг изменился после черновика — посев устарел, публикуется только новый черновик.
    await t.admin.athleteRating.update({
      where: { athleteId: top.athleteId },
      data: { rating: 310, peakRating: 310 },
    });
    const stale = await send(
      rated.staff.manager,
      'post',
      `/api/v1/draws/${draw.id}/publish`,
      {},
      draw.version,
    );
    expect(stale.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['draw_input_changed'] },
    });
    await t.admin.athleteRating.update({ where: { athleteId: top.athleteId }, data: { rating: 300 } });

    const published = await send(
      rated.staff.manager,
      'post',
      `/api/v1/draws/${draw.id}/publish`,
      {},
      draw.version,
    );
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const brackets = await t.admin.bracket.findMany({
      where: { drawId: draw.id },
      orderBy: { stageOrder: 'asc' },
      include: { _count: { select: { nodes: true } } },
    });
    expect(brackets.map((b) => [b.kind, b.stageOrder, b.label, b._count.nodes])).toEqual([
      ['POOL', 1, 'A', 3],
      ['POOL', 2, 'B', 3],
      ['POOL', 3, 'C', 3],
      ['POOL', 4, 'D', 6],
      ['FINAL', 5, null, 7],
    ]);
    expect(
      await t.admin.match.count({ where: { categoryId: cat.categoryId, matchNumber: { not: null } } }),
    ).toBe(22);
    const view = await rated.staff.manager.agent
      .get(`/api/v1/categories/${cat.categoryId}/brackets`)
      .expect(200);
    const bracket = (view.body.data as CategoryBracketDto).bracket!;
    expect(bracket.format).toBe('SPECIAL_GROUP_RATED');
    expect(bracket.nodes.every((n) => n.match !== null)).toBe(true);
    expect(bracket.nodes.filter((n) => n.group === null).map((n) => n.stage)).toEqual(Array(7).fill('FINAL'));
    expect(bracket.groups?.standings).toHaveLength(4);
    expect(bracket.participants.find((p) => p.seedNumber === 1)).toMatchObject({
      pool: 'A',
      ratingAtDraw: 300,
    });

    // Посев опубликованной жеребьёвки не меняется обычным изменением строки (ТЗ 28).
    await expect(
      t.admin.tournamentSeed.update({ where: { id: top.id }, data: { ratingAtDraw: 999 } }),
    ).rejects.toThrow(/immutable/);
  });

  it('builds one round-robin group for 3–5 athletes', async () => {
    const cat = await ratedCategory(4);
    const r = await createDraft(cat.categoryId);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const draw = r.body.data as DrawDto;
    expect(new Set(draw.slots.map((s) => s.pool))).toEqual(new Set(['A']));
    expect(draw.bracket.nodes).toHaveLength(6);
    expect(draw.bracket.groups).toMatchObject({ qualifiersPerGroup: 0, standings: [{ group: 'A' }] });
  });

  it('refuses manual seeding in the rated format', async () => {
    const cat = await ratedCategory(6);
    const r = await createDraft(cat.categoryId, { seeding: [{ entryId: cat.entries[0], seedNumber: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.details.fields).toEqual([{ path: 'seeding', code: 'rated_seeding_by_rating' }]);
  });
});

describe('rated group standings', () => {
  it('ranks a refereed single group by its table and takes the places from it', async () => {
    const w = await refereeWorld(t, [{ admitted: 4 }], async (world) => {
      await t.admin.competition.update({
        where: { id: world.competitionId },
        data: { competitionType: 'RATED' },
      });
    });
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const view = async (): Promise<BracketViewDto> => {
      const r = await chief.agent.get(`/api/v1/categories/${categoryId}/brackets`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body.data as CategoryBracketDto).bracket!;
    };
    const before = await view();
    expect(before.format).toBe('SPECIAL_GROUP_RATED');
    expect(before.groups!.standings[0]).toMatchObject({
      group: 'A',
      complete: false,
      decisionRequired: false,
    });
    // Побеждает меньший номер посева: 3, 2, 1 и 0 побед.
    const seed = new Map(before.participants.map((p) => [p.entryId, p.seedNumber!]));
    const matches = await scheduledMatches(t, categoryId);
    expect(matches).toHaveLength(6);
    for (const m of matches) {
      const red = m.participants.find((p) => p.side === 'RED')!.entryId!;
      const blue = m.participants.find((p) => p.side === 'BLUE')!.entryId!;
      const played = await playToResult(chief, m.id, seed.get(red)! < seed.get(blue)! ? 'RED' : 'BLUE');
      const c = await confirm(chief, played);
      expect(c.status, JSON.stringify(c.body)).toBe(200);
    }

    const [group] = (await view()).groups!.standings;
    expect(group).toMatchObject({ complete: true, decisionRequired: false });
    expect(
      group!.rows.map((r) => [
        seed.get(r.entryId),
        r.position,
        r.matches,
        r.wins,
        r.losses,
        r.points,
        r.qualified,
      ]),
    ).toEqual([
      [1, 1, 3, 3, 0, 12, null],
      [2, 2, 3, 2, 1, 8, null],
      [3, 3, 3, 1, 2, 4, null],
      [4, 4, 3, 0, 3, 0, null],
    ]);
    const r = await chief.agent.get(`/api/v1/categories/${categoryId}/results`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const results = r.body.data as CategoryResultsDto;
    expect(results.status).toBe('PROVISIONAL');
    expect(results.placements.map((p) => [seed.get(p.entryId), p.place, p.wins, p.losses])).toEqual([
      [1, 1, 3, 0],
      [2, 2, 2, 1],
      [3, 3, 1, 2],
      [4, 4, 0, 3],
    ]);
  });

  it('fills the final part from the group places and takes the places from it', async () => {
    const w = await refereeWorld(t, [{ admitted: 6 }], async (world) => {
      await t.admin.competition.update({
        where: { id: world.competitionId },
        data: { competitionType: 'RATED' },
      });
    });
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const view = async (): Promise<BracketViewDto> => {
      const r = await chief.agent.get(`/api/v1/categories/${categoryId}/brackets`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body.data as CategoryBracketDto).bracket!;
    };
    const before = await view();
    const seed = new Map(before.participants.map((p) => [p.entryId, p.seedNumber!]));
    const final = (b: BracketViewDto) => b.nodes.filter((n) => n.stage === 'FINAL');
    expect(final(before).map((n) => [n.label, n.red.source, n.blue.source, n.red.entryId])).toEqual([
      ['SEMIFINAL', { type: 'POOL_RANK', ref: 'A:1' }, { type: 'POOL_RANK', ref: 'B:2' }, null],
      ['SEMIFINAL', { type: 'POOL_RANK', ref: 'B:1' }, { type: 'POOL_RANK', ref: 'A:2' }, null],
      ['FINAL', { type: 'WINNER_OF', ref: 'FINAL:1:1' }, { type: 'WINNER_OF', ref: 'FINAL:1:2' }, null],
    ]);
    // Каждую готовую схватку выигрывает меньший номер посева, пока сетка не сыграна.
    const playReady = async (): Promise<number> => {
      const ready = (await scheduledMatches(t, categoryId)).filter(
        (m) => !m.result && m.participants.length === 2 && m.participants.every((p) => p.entryId && !p.isBye),
      );
      for (const m of ready) {
        const red = m.participants.find((p) => p.side === 'RED')!.entryId!;
        const blue = m.participants.find((p) => p.side === 'BLUE')!.entryId!;
        const played = await playToResult(chief, m.id, seed.get(red)! < seed.get(blue)! ? 'RED' : 'BLUE');
        const c = await confirm(chief, played);
        expect(c.status, JSON.stringify(c.body)).toBe(200);
      }
      return ready.length;
    };
    // Подгруппы (6 схваток) — затем полуфиналы получают участников по местам подгрупп.
    expect(await playReady()).toBe(6);
    const afterGroups = await view();
    // Змейка: A — посевы 1, 4, 5; B — 2, 3, 6. A1 = 1, A2 = 4, B1 = 2, B2 = 3.
    expect(
      final(afterGroups).map((n) => [
        n.red.entryId && seed.get(n.red.entryId),
        n.blue.entryId && seed.get(n.blue.entryId),
      ]),
    ).toEqual([
      [1, 3],
      [2, 4],
      [null, null],
    ]);
    expect(afterGroups.groups!.standings.every((g) => g.complete && !g.decisionRequired)).toBe(true);
    expect(await playReady()).toBe(2);
    expect(await playReady()).toBe(1);

    const r = await chief.agent.get(`/api/v1/categories/${categoryId}/results`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const results = r.body.data as CategoryResultsDto;
    expect(results.status).toBe('PROVISIONAL');
    // Схватки за 3 место нет: оба проигравших полуфиналы — 3; третьи места подгрупп (A — посев 5, B — 6) делят 5 место
    // после четырёх участников финальной части (Q-F5).
    expect(
      results.placements
        .map((p) => [seed.get(p.entryId)!, p.place, p.wins, p.losses])
        .sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!),
    ).toEqual([
      [1, 1, 4, 0],
      [2, 2, 3, 1],
      [3, 3, 1, 2],
      [4, 3, 1, 2],
      [5, 5, 0, 2],
      [6, 5, 0, 2],
    ]);
  });

  it('waits for the chief judge to order a shared group place, then fills the final part', async () => {
    const w = await refereeWorld(t, [{ admitted: 6 }], async (world) => {
      await t.admin.competition.update({
        where: { id: world.competitionId },
        data: { competitionType: 'RATED' },
      });
    });
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const draw = await t.admin.draw.findFirstOrThrow({ where: { categoryId, status: 'PUBLISHED' } });
    const view = async (): Promise<BracketViewDto> => {
      const r = await chief.agent.get(`/api/v1/categories/${categoryId}/brackets`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body.data as CategoryBracketDto).bracket!;
    };
    const before = await view();
    const seed = new Map(before.participants.map((p) => [p.entryId, p.seedNumber!]));
    const entryOfSeed = (n: number): string => [...seed.entries()].find(([, s]) => s === n)![0];
    // Подгруппа A — посевы 1, 4, 5: 1 > 4, 4 > 5, 5 > 1 — все по одной победе по баллам, критерии не разделяют.
    for (const m of await scheduledMatches(t, categoryId)) {
      const red = m.participants.find((p) => p.side === 'RED')?.entryId;
      const blue = m.participants.find((p) => p.side === 'BLUE')?.entryId;
      if (!red || !blue) continue;
      const [r, b] = [seed.get(red)!, seed.get(blue)!];
      const cycle = new Set([r, b]).has(1) && new Set([r, b]).has(5);
      const winner = cycle ? (r === 5 ? 'RED' : 'BLUE') : r < b ? 'RED' : 'BLUE';
      const c = await confirm(chief, await playToResult(chief, m.id, winner));
      expect(c.status, JSON.stringify(c.body)).toBe(200);
    }
    const tied = await view();
    const a = tied.groups!.standings.find((g) => g.group === 'A')!;
    expect(a).toMatchObject({ complete: true, decisionRequired: true, decision: null });
    expect(a.rows.map((r) => r.position)).toEqual([1, 1, 1]);
    expect(tied.groups!.canDecide).toBe(true);
    const semis = tied.nodes.filter((n) => n.stage === 'FINAL' && n.label === 'SEMIFINAL');
    expect(
      semis.map((n) => [
        n.red.entryId && seed.get(n.red.entryId),
        n.blue.entryId && seed.get(n.blue.entryId),
      ]),
    ).toEqual([
      [null, 3],
      [2, null],
    ]);

    const url = `/api/v1/draws/${draw.id}/group-decisions`;
    const order = [entryOfSeed(4), entryOfSeed(1), entryOfSeed(5)];
    // Судья без права изменять результаты решить не может; решение должно покрывать ровно общее место.
    expect(
      (await send(w.refs.judge1.s, 'post', url, { group: 'A', tiers: [order], reason: 'Решение ГСК' }))
        .status,
    ).toBe(403);
    const partial = await send(chief, 'post', url, {
      group: 'A',
      tiers: [order.slice(0, 2)],
      reason: 'Решение ГСК',
    });
    expect(partial.status).toBe(422);
    expect(partial.body.error).toMatchObject({ code: 'GROUP_DECISION_MISMATCH', details: { group: 'A' } });
    expect(
      (await send(chief, 'post', url, { group: 'B', tiers: [order], reason: 'Решение ГСК' })).body.error.code,
    ).toBe('GROUP_DECISION_MISMATCH');
    const ok = await send(chief, 'post', url, {
      group: 'A',
      tiers: [order],
      reason: 'Решение ГСК по жребию',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const decided = await view();
    const da = decided.groups!.standings.find((g) => g.group === 'A')!;
    expect(da).toMatchObject({ decisionRequired: false, decision: { reason: 'Решение ГСК по жребию' } });
    expect(da.rows.map((r) => [seed.get(r.entryId), r.position, r.qualified])).toEqual([
      [4, 1, true],
      [1, 2, true],
      [5, 3, false],
    ]);
    // A1 = 4, A2 = 1; B1 = 2, B2 = 3.
    expect(
      decided.nodes
        .filter((n) => n.stage === 'FINAL' && n.label === 'SEMIFINAL')
        .map((n) => [seed.get(n.red.entryId!), seed.get(n.blue.entryId!)]),
    ).toEqual([
      [4, 3],
      [2, 1],
    ]);
    expect(
      await t.admin.auditLog.count({ where: { action: 'bracket.group_places_decided', entityId: draw.id } }),
    ).toBe(1);
    const row = await t.admin.groupPlaceDecision.findFirstOrThrow({ where: { drawId: draw.id } });
    await expect(
      t.admin.groupPlaceDecision.update({ where: { id: row.id }, data: { reason: 'x' } }),
    ).rejects.toThrow(/immutable/);
    // Новое решение заменяет прежнее, пока зависящие схватки не начаты: A1 = 1, A2 = 4.
    const again = [entryOfSeed(1), entryOfSeed(4), entryOfSeed(5)];
    const replaced = await send(chief, 'post', url, {
      group: 'A',
      tiers: [again],
      reason: 'Исправление ГСК',
    });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    const semis2 = (await view()).nodes.filter((n) => n.stage === 'FINAL' && n.label === 'SEMIFINAL');
    expect(semis2.map((n) => [seed.get(n.red.entryId!), seed.get(n.blue.entryId!)])).toEqual([
      [1, 3],
      [2, 4],
    ]);
    // Полуфинал сыгран — решение, которое поменяло бы его участников, не принимается.
    const semi = semis2[0]!.match!;
    expect((await confirm(chief, await playToResult(chief, semi.id, 'RED'))).status).toBe(200);
    const late = await send(chief, 'post', url, { group: 'A', tiers: [order], reason: 'Поздно' });
    expect(late.body.error.code).toBe('DEPENDENT_MATCHES_STARTED');
    expect((await view()).groups!.standings[0]!.decision).toMatchObject({ reason: 'Исправление ГСК' });
  });
});
