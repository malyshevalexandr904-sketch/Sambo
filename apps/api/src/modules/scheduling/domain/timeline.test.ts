import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateSchedule, type GenerateScheduleInput } from './generator';
import { computeTimeline, type TimelineItem } from './timeline';
import type { CategoryInput, MatchInput, MatInput, SessionInput } from './types';

const mat = (id: string, number: number): MatInput => ({ id, number });
const session = (id: string, startsAt: number, endsAt: number): SessionInput => ({ id, startsAt, endsAt });
const item = (
  over: Partial<TimelineItem> &
    Pick<TimelineItem, 'matchId' | 'sessionId' | 'matId' | 'orderInMat' | 'durationSeconds'>,
): TimelineItem => ({ dependsOn: [], athleteIds: [], ...over });

const DAY_START = 1_800_000_000;
const HOUR = 3_600;
const SESSIONS = [session('s1', DAY_START, DAY_START + 8 * HOUR)];

describe('computeTimeline: базовый пересчёт по заданной расстановке', () => {
  it('одна схватка на ковре стартует в начале сессии', () => {
    const result = computeTimeline({
      items: [item({ matchId: 'm1', sessionId: 's1', matId: 'mat1', orderInMat: 1, durationSeconds: 180 })],
      sessions: SESSIONS,
      minRestSeconds: 600,
      matChangeoverSeconds: 60,
    });
    expect(result.orderViolations).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.placements).toEqual([
      { matchId: 'm1', sessionId: 's1', matId: 'mat1', orderInMat: 1, plannedAt: DAY_START, endsAt: DAY_START + 180 },
    ]);
  });

  it('вторая схватка того же ковра стартует после первой плюс смена пары', () => {
    const result = computeTimeline({
      items: [
        item({ matchId: 'm1', sessionId: 's1', matId: 'mat1', orderInMat: 1, durationSeconds: 180 }),
        item({ matchId: 'm2', sessionId: 's1', matId: 'mat1', orderInMat: 2, durationSeconds: 180 }),
      ],
      sessions: SESSIONS,
      minRestSeconds: 0,
      matChangeoverSeconds: 60,
    });
    const m2 = result.placements.find((p) => p.matchId === 'm2')!;
    expect(m2.plannedAt).toBe(DAY_START + 180 + 60);
  });
});

describe('computeTimeline: зависимости между коврами', () => {
  it('схватка на другом ковре не начинается раньше конца своей зависимости', () => {
    const result = computeTimeline({
      items: [
        item({ matchId: 'a', sessionId: 's1', matId: 'mat1', orderInMat: 1, durationSeconds: 1_800 }),
        item({ matchId: 'b', sessionId: 's1', matId: 'mat2', orderInMat: 1, durationSeconds: 180, dependsOn: ['a'] }),
      ],
      sessions: SESSIONS,
      minRestSeconds: 0,
      matChangeoverSeconds: 60,
    });
    const a = result.placements.find((p) => p.matchId === 'a')!;
    const b = result.placements.find((p) => p.matchId === 'b')!;
    expect(result.orderViolations).toEqual([]);
    expect(b.plannedAt).toBeGreaterThanOrEqual(a.endsAt);
  });

  it('тупик: схватка стоит на ковре раньше своей зависимости — фиксируется как нарушение порядка', () => {
    const result = computeTimeline({
      items: [
        // На одном ковре b стоит первой в очереди, хотя зависит от a — a никогда не наступит раньше b.
        item({ matchId: 'b', sessionId: 's1', matId: 'mat1', orderInMat: 1, durationSeconds: 180, dependsOn: ['a'] }),
        item({ matchId: 'a', sessionId: 's1', matId: 'mat1', orderInMat: 2, durationSeconds: 180 }),
      ],
      sessions: SESSIONS,
      minRestSeconds: 0,
      matChangeoverSeconds: 60,
    });
    expect(result.orderViolations).toEqual([{ matchId: 'b', blockedOn: 'a' }]);
    expect(result.placements).toEqual([]);
  });
});

describe('computeTimeline: предупреждения (не блокируют сохранение)', () => {
  it('отдых после зависимости меньше минимального — предупреждение rest_dependency', () => {
    const result = computeTimeline({
      items: [
        item({ matchId: 'a', sessionId: 's1', matId: 'mat1', orderInMat: 1, durationSeconds: 180 }),
        item({ matchId: 'b', sessionId: 's1', matId: 'mat2', orderInMat: 1, durationSeconds: 180, dependsOn: ['a'] }),
      ],
      sessions: SESSIONS,
      minRestSeconds: 900,
      matChangeoverSeconds: 60,
    });
    expect(result.orderViolations).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ matchId: 'b', kind: 'rest_dependency' }),
    );
  });

  it('один спортсмен в двух схватках подряд с недостаточным отдыхом — предупреждение rest_athlete', () => {
    const result = computeTimeline({
      items: [
        item({ matchId: 'a', sessionId: 's1', matId: 'mat1', orderInMat: 1, durationSeconds: 180, athleteIds: ['x'] }),
        item({ matchId: 'b', sessionId: 's1', matId: 'mat2', orderInMat: 1, durationSeconds: 180, athleteIds: ['x'] }),
      ],
      sessions: SESSIONS,
      minRestSeconds: 900,
      matChangeoverSeconds: 60,
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({ matchId: 'b', kind: 'rest_athlete' }));
  });

  it('схватка выходит за конец сессии — предупреждение session_overflow', () => {
    const result = computeTimeline({
      items: [item({ matchId: 'a', sessionId: 's1', matId: 'mat1', orderInMat: 1, durationSeconds: 9 * HOUR })],
      sessions: SESSIONS,
      minRestSeconds: 0,
      matChangeoverSeconds: 60,
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ matchId: 'a', kind: 'session_overflow', shortfallSeconds: HOUR }),
    );
  });
});

describe('computeTimeline: согласованность с автогенерацией', () => {
  const chainInput = (
    categoryCount: number,
    chainLength: number,
    matCount: number,
    durations: number[],
  ): GenerateScheduleInput => {
    const mats = Array.from({ length: matCount }, (_, i) => mat(`mat${i}`, i + 1));
    const categories: CategoryInput[] = Array.from({ length: categoryCount }, (_, i) => ({
      id: `cat${i}`,
      sortOrder: i,
      pinnedMatId: null,
    }));
    const matches: MatchInput[] = [];
    for (let c = 0; c < categoryCount; c++) {
      for (let r = 0; r < chainLength; r++) {
        matches.push({
          id: `cat${c}-r${r}`,
          categoryId: `cat${c}`,
          orderInCategory: r,
          durationSeconds: durations[(c * chainLength + r) % durations.length] ?? 180,
          dependsOn: r > 0 ? [`cat${c}-r${r - 1}`] : [],
          athleteIds: [],
          isFinalsBlock: false,
        });
      }
    }
    return {
      sessions: [session('s1', DAY_START, DAY_START + 48 * HOUR)],
      mats,
      categories,
      matches,
      matChangeoverSeconds: 60,
      minRestSeconds: 300,
      finalsBlock: false,
    };
  };

  // computeTimeline пересчитывает время строго по заданной позиции (ковёр/сессия/порядок) и трактует отдых
  // только как предупреждение (см. заголовок timeline.ts), а не как обязательный зазор — в отличие от генератора,
  // который сам добавляет отдых к зависимостям, чтобы не создавать предупреждений на пустом месте (generator.ts).
  // Поэтому тайминги генератора и общего пересчёта по тем же позициям не обязаны совпадать: пересчёт использует
  // более слабые (только жёсткие) ограничения, значит его время — не позже, чем у генератора. Это и проверяем,
  // плюс что для готовой расстановки генератора у пересчёта в принципе никогда нет нарушений порядка зависимостей.
  it('пересчёт по расстановке автогенератора не находит нарушений порядка и не даёт время позже исходного', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.integer({ min: 60, max: 600 }), { minLength: 1, maxLength: 6 }),
        (categoryCount, chainLength, matCount, durations) => {
          const input = chainInput(categoryCount, chainLength, matCount, durations);
          const generated = generateSchedule(input);
          expect(generated.unassigned).toEqual([]); // цепочки без ковров/переполнения сессии в этой фикстуре
          const matchById = new Map(input.matches.map((m) => [m.id, m]));
          const items: TimelineItem[] = generated.placements.map((p) => {
            const m = matchById.get(p.matchId)!;
            return {
              matchId: p.matchId,
              sessionId: p.sessionId,
              matId: p.matId,
              orderInMat: p.orderInMat,
              durationSeconds: m.durationSeconds,
              dependsOn: m.dependsOn,
              athleteIds: m.athleteIds,
            };
          });
          const recomputed = computeTimeline({
            items,
            sessions: input.sessions,
            minRestSeconds: input.minRestSeconds,
            matChangeoverSeconds: input.matChangeoverSeconds,
          });
          expect(recomputed.orderViolations).toEqual([]);
          expect(recomputed.placements).toHaveLength(items.length);
          const byId = new Map(recomputed.placements.map((p) => [p.matchId, p]));
          for (const p of generated.placements) {
            const r = byId.get(p.matchId)!;
            expect(r.plannedAt).toBeLessThanOrEqual(p.plannedAt);
            expect(r.endsAt).toBeLessThanOrEqual(p.endsAt);
          }
        },
      ),
      { numRuns: 80 },
    );
  });

  it('когда минимальный отдых не превышает смену пары, пересчёт совпадает с генератором тик в тик', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.integer({ min: 60, max: 600 }), { minLength: 1, maxLength: 6 }),
        (categoryCount, chainLength, matCount, durations) => {
          const input = { ...chainInput(categoryCount, chainLength, matCount, durations), minRestSeconds: 60 };
          const generated = generateSchedule(input);
          const matchById = new Map(input.matches.map((m) => [m.id, m]));
          const items: TimelineItem[] = generated.placements.map((p) => {
            const m = matchById.get(p.matchId)!;
            return {
              matchId: p.matchId,
              sessionId: p.sessionId,
              matId: p.matId,
              orderInMat: p.orderInMat,
              durationSeconds: m.durationSeconds,
              dependsOn: m.dependsOn,
              athleteIds: m.athleteIds,
            };
          });
          const recomputed = computeTimeline({
            items,
            sessions: input.sessions,
            minRestSeconds: input.minRestSeconds,
            matChangeoverSeconds: input.matChangeoverSeconds,
          });
          expect(recomputed.orderViolations).toEqual([]);
          expect(recomputed.warnings).toEqual([]);
          const byId = new Map(recomputed.placements.map((p) => [p.matchId, p]));
          for (const p of generated.placements) expect(byId.get(p.matchId)).toEqual(p);
        },
      ),
      { numRuns: 80 },
    );
  });
});
