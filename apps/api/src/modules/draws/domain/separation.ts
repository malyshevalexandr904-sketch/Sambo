// Разведение (ARCHITECTURE.md, 14.5, шаг 4): спортсмены одного клуба (региона) — как можно дальше друг от друга в
// сетке на выбывание: сначала разные половины, затем четверти. Штраф пары — 4^(K − круг встречи): встреча в первом
// круге несравнимо хуже встречи в полуфинале. Ключи разведения сравниваются по приоритету (лексикографически).
// Невыполнимое разведение не отменяет жеребьёвку, а попадает в отчёт.
import { meetingRound } from '@sde/contracts';
import type { DrawParticipant, SeparationKey } from './draw-input';

export interface SeparationGroup {
  key: SeparationKey;
  /** Идентификатор организации или региона (без ПДн). */
  value: string;
  size: number;
  /** Самый поздний круг первой встречи, достижимый при таком числе спортсменов в группе. */
  idealRound: number;
  /** Круг, в котором двое из группы могут встретиться раньше всего при этой расстановке. */
  achievedRound: number;
}

export interface SeparationReport {
  applicable: boolean;
  keys: SeparationKey[];
  groups: SeparationGroup[];
  /** Группы, разведённые хуже возможного. */
  unmet: number;
}

const FIELD: Record<SeparationKey, 'organizationKey' | 'regionKey'> = {
  ORGANIZATION: 'organizationKey',
  REGION: 'regionKey',
};

export const keyValue = (p: DrawParticipant, key: SeparationKey): string | null => p[FIELD[key]];

/** Лексикографическое сравнение векторов штрафа: отрицательное — первый лучше. */
export function compareVectors(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Размещение: позиция → участник. Штраф считается по уже размещённым участникам той же группы. */
export class Placement {
  private readonly byPosition = new Map<number, DrawParticipant>();
  private readonly positionOf = new Map<string, number>();
  /** Ключ разведения → значение → участники группы. */
  private readonly groups: Map<string, Set<string>>[];

  constructor(
    private readonly rounds: number,
    private readonly keys: readonly SeparationKey[],
  ) {
    this.groups = keys.map(() => new Map<string, Set<string>>());
  }

  place(p: DrawParticipant, position: number): void {
    this.byPosition.set(position, p);
    this.positionOf.set(p.entryId, position);
    this.keys.forEach((key, i) => {
      const value = keyValue(p, key);
      if (value === null) return;
      const map = this.groups[i] as Map<string, Set<string>>;
      map.set(value, (map.get(value) ?? new Set()).add(p.entryId));
    });
  }

  at(position: number): DrawParticipant | undefined {
    return this.byPosition.get(position);
  }

  position(entryId: string): number | undefined {
    return this.positionOf.get(entryId);
  }

  entries(): [number, DrawParticipant][] {
    return [...this.byPosition.entries()];
  }

  /** Штраф участника на позиции относительно размещённых (кроме исключённых) — по каждому ключу. */
  penalty(p: DrawParticipant, position: number, exclude: ReadonlySet<string> = new Set()): number[] {
    return this.keys.map((key, i) => {
      const value = keyValue(p, key);
      if (value === null) return 0;
      let sum = 0;
      for (const other of this.groups[i]?.get(value) ?? []) {
        if (other === p.entryId || exclude.has(other)) continue;
        const pos = this.positionOf.get(other);
        if (pos !== undefined) sum += 4 ** (this.rounds - meetingRound(position, pos));
      }
      return sum;
    });
  }

  /** Обмен двух участников, если он уменьшает суммарный штраф (лексикографически). */
  trySwap(a: number, b: number): boolean {
    const pa = this.byPosition.get(a);
    const pb = this.byPosition.get(b);
    if (!pa || !pb) return false;
    if (this.keys.every((k) => keyValue(pa, k) === keyValue(pb, k))) return false;
    const both = new Set([pa.entryId, pb.entryId]);
    const sum = (x: number[], y: number[]): number[] => x.map((v, i) => v + (y[i] ?? 0));
    const before = sum(this.penalty(pa, a, both), this.penalty(pb, b, both));
    const after = sum(this.penalty(pa, b, both), this.penalty(pb, a, both));
    if (compareVectors(after, before) >= 0) return false;
    this.place(pa, b);
    this.place(pb, a);
    return true;
  }
}

/** Лучший возможный круг первой встречи для группы из m спортсменов в сетке из K кругов. */
export function idealMeetingRound(rounds: number, groupSize: number): number {
  return Math.max(1, rounds - Math.ceil(Math.log2(groupSize)) + 1);
}

export function separationReport(
  participants: readonly DrawParticipant[],
  positions: ReadonlyMap<string, number>,
  keys: readonly SeparationKey[],
  rounds: number,
): SeparationReport {
  const groups: SeparationGroup[] = [];
  for (const key of keys) {
    const byValue = new Map<string, number[]>();
    for (const p of participants) {
      const value = keyValue(p, key);
      const pos = positions.get(p.entryId);
      if (value === null || pos === undefined) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), pos]);
    }
    for (const [value, list] of [...byValue.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (list.length < 2) continue;
      let achieved = rounds;
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          achieved = Math.min(achieved, meetingRound(list[i] ?? 0, list[j] ?? 0));
      groups.push({
        key,
        value,
        size: list.length,
        idealRound: idealMeetingRound(rounds, list.length),
        achievedRound: achieved,
      });
    }
  }
  return {
    applicable: true,
    keys: [...keys],
    groups,
    unmet: groups.filter((g) => g.achievedRound < g.idealRound).length,
  };
}
