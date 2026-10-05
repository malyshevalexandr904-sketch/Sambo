import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateSchedule, type GenerateScheduleInput } from './generator';
import type { CategoryInput, MatchInput, MatInput, SessionInput } from './types';

const mat = (id: string, number: number): MatInput => ({ id, number });
const session = (id: string, startsAt: number, endsAt: number): SessionInput => ({ id, startsAt, endsAt });
const category = (id: string, sortOrder: number, pinnedMatId: string | null = null): CategoryInput => ({
  id,
  sortOrder,
  pinnedMatId,
});
const match = (
  over: Partial<MatchInput> & Pick<MatchInput, 'id' | 'categoryId' | 'orderInCategory' | 'durationSeconds'>,
): MatchInput => ({ dependsOn: [], athleteIds: [], isFinalsBlock: false, ...over });

const DAY_START = 1_800_000_000; // произвольная эпоха, секунды
const HOUR = 3_600;

/** Прогон с типовыми настройками смены пары и минимального отдыха, если тест не переопределяет их. */
function run(over: Partial<GenerateScheduleInput>): GenerateScheduleInput {
  return {
    sessions: [session('s1', DAY_START, DAY_START + 8 * HOUR)],
    mats: [mat('m1', 1)],
    categories: [],
    matches: [],
    matChangeoverSeconds: 60,
    minRestSeconds: 600,
    finalsBlock: true,
    ...over,
  };
}

describe('generateSchedule: базовая расстановка на одном ковре', () => {
  it('цепочка зависимых схваток идёт по порядку с учётом смены пары', () => {
    const matches = [
      match({ id: 'm1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 180 }),
      match({ id: 'm2', categoryId: 'c1', orderInCategory: 2, durationSeconds: 180, dependsOn: ['m1'] }),
      match({ id: 'm3', categoryId: 'c1', orderInCategory: 3, durationSeconds: 180, dependsOn: ['m2'] }),
    ];
    const result = generateSchedule(run({ categories: [category('c1', 1)], matches, minRestSeconds: 0 }));
    expect(result.unassigned).toEqual([]);
    expect(result.warnings).toEqual([]);
    const byId = new Map(result.placements.map((p) => [p.matchId, p]));
    expect(byId.get('m1')!.orderInMat).toBe(1);
    expect(byId.get('m2')!.orderInMat).toBe(2);
    expect(byId.get('m3')!.orderInMat).toBe(3);
    // Смена пары: следующая схватка не раньше конца предыдущей + 60с.
    expect(byId.get('m2')!.plannedAt).toBe(byId.get('m1')!.endsAt + 60);
    expect(byId.get('m3')!.plannedAt).toBe(byId.get('m2')!.endsAt + 60);
  });

  it('зависимая схватка не раньше конца зависимости плюс минимальный отдых', () => {
    const matches = [
      match({ id: 'm1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 300 }),
      match({ id: 'm2', categoryId: 'c1', orderInCategory: 2, durationSeconds: 300, dependsOn: ['m1'] }),
    ];
    const result = generateSchedule(run({ categories: [category('c1', 1)], matches, minRestSeconds: 900 }));
    const byId = new Map(result.placements.map((p) => [p.matchId, p]));
    expect(byId.get('m2')!.plannedAt).toBeGreaterThanOrEqual(byId.get('m1')!.endsAt + 900);
    expect(result.warnings).toEqual([]);
  });

  it('один участник не оказывается в двух схватках одновременно: отдых спортсмена соблюдён', () => {
    const matches = [
      match({ id: 'm1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 180, athleteIds: ['a1', 'a2'] }),
      match({ id: 'm2', categoryId: 'c2', orderInCategory: 1, durationSeconds: 180, athleteIds: ['a1', 'a3'] }),
    ];
    const result = generateSchedule(
      run({ categories: [category('c1', 1), category('c2', 2)], matches, minRestSeconds: 1200 }),
    );
    const byId = new Map(result.placements.map((p) => [p.matchId, p]));
    // Обе категории без закрепления попадут на единственный ковёр — a1 не может играть их одновременно.
    expect(byId.get('m2')!.plannedAt).toBeGreaterThanOrEqual(byId.get('m1')!.endsAt + 1200);
    expect(result.warnings).toEqual([]);
  });
});

describe('generateSchedule: закрепление категории за ковром', () => {
  it('закреплённая категория целиком остаётся на своём ковре независимо от загрузки', () => {
    const matches = [
      match({ id: 'm1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 180 }),
      match({ id: 'm2', categoryId: 'c1', orderInCategory: 2, durationSeconds: 180 }),
      match({ id: 'm3', categoryId: 'c2', orderInCategory: 1, durationSeconds: 180 }),
    ];
    const result = generateSchedule(
      run({
        mats: [mat('m-a', 1), mat('m-b', 2)],
        categories: [category('c1', 1, 'm-b'), category('c2', 2)],
        matches,
      }),
    );
    const byId = new Map(result.placements.map((p) => [p.matchId, p]));
    expect(byId.get('m1')!.matId).toBe('m-b');
    expect(byId.get('m2')!.matId).toBe('m-b');
  });

  it('закреплённая вручную схватка (pinned) не переносится генерацией и её слот не занимается заново', () => {
    const matches = [
      match({
        id: 'm1',
        categoryId: 'c1',
        orderInCategory: 1,
        durationSeconds: 180,
        pinned: { sessionId: 's1', matId: 'm1-mat', orderInMat: 5 },
      }),
      match({ id: 'm2', categoryId: 'c1', orderInCategory: 2, durationSeconds: 180 }),
    ];
    const result = generateSchedule(run({ mats: [mat('m1-mat', 1)], categories: [category('c1', 1)], matches }));
    // Закреплённая схватка не попадает в результаты генерации (её место уже задано человеком).
    expect(result.placements.find((p) => p.matchId === 'm1')).toBeUndefined();
    const m2 = result.placements.find((p) => p.matchId === 'm2')!;
    expect(m2.orderInMat).not.toBe(5);
  });
});

describe('generateSchedule: распределение категорий по коврам (LPT)', () => {
  it('балансирует суммарную загрузку ковров', () => {
    const durations = [500, 400, 300, 200];
    const categories = durations.map((_, i) => category(`c${i}`, i));
    const matches = durations.map((d, i) => match({ id: `m${i}`, categoryId: `c${i}`, orderInCategory: 1, durationSeconds: d }));
    const result = generateSchedule(run({ mats: [mat('m-a', 1), mat('m-b', 2)], categories, matches, minRestSeconds: 0 }));
    const loadA = result.matLoad.find((l) => l.matId === 'm-a')!.totalSeconds;
    const loadB = result.matLoad.find((l) => l.matId === 'm-b')!.totalSeconds;
    // LPT: 500→A(500), 400→B(400), 300→B(700), 200→A(700) — оба ковра равны.
    expect(loadA).toBe(700);
    expect(loadB).toBe(700);
  });
});

describe('generateSchedule: блок финалов', () => {
  it('финалы и схватки за 3-е место не раньше конца обычной части на всех коврах', () => {
    const matches = [
      match({ id: 'r1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 180 }),
      match({ id: 'r2', categoryId: 'c2', orderInCategory: 1, durationSeconds: 3_000 }), // долгая категория на другом ковре
      match({ id: 'final', categoryId: 'c1', orderInCategory: 2, durationSeconds: 300, isFinalsBlock: true, dependsOn: ['r1'] }),
    ];
    const result = generateSchedule(
      run({
        mats: [mat('m-a', 1), mat('m-b', 2)],
        categories: [category('c1', 1), category('c2', 2)],
        matches,
        finalsBlock: true,
        minRestSeconds: 0,
      }),
    );
    const byId = new Map(result.placements.map((p) => [p.matchId, p]));
    const r2End = byId.get('r2')!.endsAt;
    expect(byId.get('final')!.plannedAt).toBeGreaterThanOrEqual(r2End);
  });

  it('без блока финалов финал ставится сразу за своей зависимостью, не дожидаясь других ковров', () => {
    const matches = [
      match({ id: 'r1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 180 }),
      match({ id: 'r2', categoryId: 'c2', orderInCategory: 1, durationSeconds: 3_000 }),
      match({ id: 'final', categoryId: 'c1', orderInCategory: 2, durationSeconds: 300, isFinalsBlock: true, dependsOn: ['r1'] }),
    ];
    const result = generateSchedule(
      run({
        mats: [mat('m-a', 1), mat('m-b', 2)],
        categories: [category('c1', 1), category('c2', 2)],
        matches,
        finalsBlock: false,
        minRestSeconds: 0,
      }),
    );
    const byId = new Map(result.placements.map((p) => [p.matchId, p]));
    expect(byId.get('final')!.plannedAt).toBe(byId.get('r1')!.endsAt + 60);
  });
});

describe('generateSchedule: нераспределённые схватки', () => {
  it('без активных ковров все схватки уходят в «Не распределены» с причиной no_active_mats', () => {
    const matches = [match({ id: 'm1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 180 })];
    const result = generateSchedule(run({ mats: [], categories: [category('c1', 1)], matches }));
    expect(result.placements).toEqual([]);
    expect(result.unassigned).toEqual([{ matchId: 'm1', categoryId: 'c1', reason: 'no_active_mats' }]);
  });

  it('схватка длиннее единственной сессии уходит в «Не распределены» с причиной no_session_capacity', () => {
    const matches = [match({ id: 'm1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 9 * HOUR })];
    const result = generateSchedule(run({ categories: [category('c1', 1)], matches }));
    expect(result.placements).toEqual([]);
    expect(result.unassigned).toEqual([{ matchId: 'm1', categoryId: 'c1', reason: 'no_session_capacity' }]);
  });

  it('когда первая сессия занята, следующая схватка категории переходит во вторую сессию', () => {
    const matches = [
      // Занимает сессию почти целиком (с учётом смены пары следующая схватка уже не влезает).
      match({ id: 'm1', categoryId: 'c1', orderInCategory: 1, durationSeconds: 8 * HOUR - 60 }),
      match({ id: 'm2', categoryId: 'c1', orderInCategory: 2, durationSeconds: 180 }),
    ];
    const result = generateSchedule(
      run({
        sessions: [
          session('s1', DAY_START, DAY_START + 8 * HOUR),
          session('s2', DAY_START + 9 * HOUR, DAY_START + 17 * HOUR),
        ],
        categories: [category('c1', 1)],
        matches,
        minRestSeconds: 0,
      }),
    );
    const byId = new Map(result.placements.map((p) => [p.matchId, p]));
    expect(byId.get('m1')!.sessionId).toBe('s1');
    expect(byId.get('m2')!.sessionId).toBe('s2');
    expect(result.unassigned).toEqual([]);
  });
});

describe('generateSchedule: свойства', () => {
  const chainInput = (
    categoryCount: number,
    chainLength: number,
    matCount: number,
    durations: number[],
  ): GenerateScheduleInput => {
    const mats = Array.from({ length: matCount }, (_, i) => mat(`mat${i}`, i + 1));
    const categories = Array.from({ length: categoryCount }, (_, i) => category(`cat${i}`, i));
    const matches: MatchInput[] = [];
    for (let c = 0; c < categoryCount; c++) {
      for (let r = 0; r < chainLength; r++) {
        const id = `cat${c}-r${r}`;
        matches.push(
          match({
            id,
            categoryId: `cat${c}`,
            orderInCategory: r,
            durationSeconds: durations[(c * chainLength + r) % durations.length] ?? 180,
            dependsOn: r > 0 ? [`cat${c}-r${r - 1}`] : [],
          }),
        );
      }
    }
    return run({
      sessions: [session('s1', DAY_START, DAY_START + 48 * HOUR)],
      mats,
      categories,
      matches,
      minRestSeconds: 300,
      finalsBlock: false,
    });
  };

  it('результат детерминирован независимо от порядка категорий, схваток и ковров во входе', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.integer({ min: 60, max: 600 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 1_000_000 }), // seed для перемешивания
        (categoryCount, chainLength, matCount, durations, shuffleSeed) => {
          const input = chainInput(categoryCount, chainLength, matCount, durations);
          const a = generateSchedule(input);
          const shuffled: GenerateScheduleInput = {
            ...input,
            mats: shuffle(input.mats, shuffleSeed),
            categories: shuffle(input.categories, shuffleSeed + 1),
            matches: shuffle(input.matches, shuffleSeed + 2),
          };
          const b = generateSchedule(shuffled);
          expect(sortPlacements(b.placements)).toEqual(sortPlacements(a.placements));
          expect(sortUnassigned(b.unassigned)).toEqual(sortUnassigned(a.unassigned));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ни одна схватка не размещена раньше своих зависимостей (плюс минимальный отдых)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.integer({ min: 60, max: 600 }), { minLength: 1, maxLength: 6 }),
        (categoryCount, chainLength, matCount, durations) => {
          const input = chainInput(categoryCount, chainLength, matCount, durations);
          const result = generateSchedule(input);
          const byId = new Map(result.placements.map((p) => [p.matchId, p]));
          const matchById = new Map(input.matches.map((m) => [m.id, m]));
          for (const p of result.placements) {
            const m = matchById.get(p.matchId)!;
            for (const dep of m.dependsOn) {
              const depPlacement = byId.get(dep);
              if (!depPlacement) continue; // зависимость сама не распределена — не проверяем
              expect(p.plannedAt).toBeGreaterThanOrEqual(depPlacement.endsAt + input.minRestSeconds);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('суммарная загрузка ковров ограничена сверху по LPT (макс ≤ среднее + самая долгая категория)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 2, max: 3 }),
        fc.array(fc.integer({ min: 60, max: 600 }), { minLength: 1, maxLength: 6 }),
        (categoryCount, chainLength, matCount, durations) => {
          const input = chainInput(categoryCount, chainLength, matCount, durations);
          const result = generateSchedule({ ...input, minRestSeconds: 0 });
          const totalByCategory = new Map<string, number>();
          for (const m of input.matches)
            totalByCategory.set(m.categoryId, (totalByCategory.get(m.categoryId) ?? 0) + m.durationSeconds);
          const total = [...totalByCategory.values()].reduce((a, b) => a + b, 0);
          const largest = Math.max(...totalByCategory.values());
          const average = total / matCount;
          const bound = average + largest;
          for (const load of result.matLoad) expect(load.totalSeconds).toBeLessThanOrEqual(bound + 1);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('generateSchedule: производительность (пилотный турнир)', () => {
  it('150 спортсменов, 3 ковра, ~200 схваток — быстрее 1 секунды', () => {
    const matCount = 3;
    const mats = Array.from({ length: matCount }, (_, i) => mat(`mat${i}`, i + 1));
    const categoryCount = 20;
    const categories = Array.from({ length: categoryCount }, (_, i) => category(`cat${i}`, i));
    const matches: MatchInput[] = [];
    for (let c = 0; c < categoryCount; c++) {
      // ~10 схваток на категорию => ~200 схваток, олимпийская сетка на 8 (round1: 4, round2: 2, final: 1) + утешительные.
      const rounds = 4;
      for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < Math.max(1, 4 - r); i++) {
          matches.push(
            match({
              id: `cat${c}-r${r}-m${i}`,
              categoryId: `cat${c}`,
              orderInCategory: r * 10 + i,
              durationSeconds: 180,
              dependsOn: r > 0 ? [`cat${c}-r${r - 1}-m${Math.floor(i / 2)}`] : [],
              athleteIds: r === 0 ? [`cat${c}-a${2 * i}`, `cat${c}-a${2 * i + 1}`] : [],
            }),
          );
        }
      }
    }
    const input = run({
      sessions: [session('s1', DAY_START, DAY_START + 12 * HOUR)],
      mats,
      categories,
      matches,
      minRestSeconds: 600,
      finalsBlock: true,
    });
    const start = performance.now();
    const result = generateSchedule(input);
    const elapsed = performance.now() - start;
    expect(result.placements.length + result.unassigned.length).toBe(matches.length);
    expect(elapsed).toBeLessThan(1_000);
  });
});

/** Детерминированное перемешивание (seeded Fisher–Yates) — устойчивее, чем полагаться на fc.shuffledSubarray порядок. */
function shuffle<T>(rows: readonly T[], seed: number): T[] {
  const arr = [...rows];
  let s = seed || 1;
  const rand = (): number => {
    s = (s * 1_103_515_245 + 12_345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

function sortPlacements(rows: readonly { matchId: string }[]) {
  return [...rows].sort((a, b) => (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));
}
function sortUnassigned(rows: readonly { matchId: string }[]) {
  return sortPlacements(rows);
}
