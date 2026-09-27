// Расстановка жеребьёвки (ARCHITECTURE.md, 14.5, шаги 3–4): размер сетки и BYE, посеянные — на места посева,
// остальные перемешиваются генератором и расставляются жадно с разведением (сначала самые большие команды),
// затем ограниченный возврат — попарные обмены, уменьшающие штраф. Результат зависит только от входа и seed.
import { drawSize, eliminationRounds, isEliminationFormat, type Pool, poolOfPosition } from '@sde/contracts';
import type { DrawInput, DrawParticipant } from './draw-input';
import { createPrng, type Prng, shuffle } from './prng';
import { byePositions, seedPositions } from './seeding';
import { compareVectors, keyValue, Placement, type SeparationReport, separationReport } from './separation';

export interface DrawSlotSpec {
  position: number;
  /** null — BYE. */
  entryId: string | null;
  seedNumber: number | null;
  pool: Pool | null;
}

export interface DrawLayout {
  size: number;
  slots: DrawSlotSpec[];
  separation: SeparationReport;
}

/** Проходы попарных обменов после жадной расстановки. */
const IMPROVEMENT_PASSES = 2;

export function computeDrawLayout(input: DrawInput, seed: string): DrawLayout {
  const prng = createPrng(seed);
  const size = drawSize(input.format, input.participants.length);
  return isEliminationFormat(input.format)
    ? eliminationLayout(input, size, prng)
    : roundRobinLayout(input, size, prng);
}

/** Круговая система: встречаются все со всеми — разведение не нужно; номер жеребьёвки задаёт порядок кругов. */
function roundRobinLayout(input: DrawInput, size: number, prng: Prng): DrawLayout {
  const byPosition = new Map<number, DrawParticipant>();
  for (const p of input.participants) if (p.seedNumber !== null) byPosition.set(p.seedNumber, p);
  const rest = shuffle(
    input.participants.filter((p) => p.seedNumber === null),
    prng,
  );
  for (let position = 1; position <= size; position++)
    if (!byPosition.has(position)) byPosition.set(position, rest.shift() as DrawParticipant);
  return {
    size,
    slots: [...byPosition.entries()]
      .sort(([a], [b]) => a - b)
      .map(([position, p]) => ({ position, entryId: p.entryId, seedNumber: p.seedNumber, pool: null })),
    separation: { applicable: false, keys: [...input.separation], groups: [], unmet: 0 },
  };
}

/** Порядок расстановки: сначала участники больших команд (их труднее развести), внутри — порядок перемешивания. */
function placementOrder(input: DrawInput, shuffled: readonly DrawParticipant[]): DrawParticipant[] {
  const sizes = input.separation.map((key) => {
    const counts = new Map<string, number>();
    for (const p of input.participants) {
      const v = keyValue(p, key);
      if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return (p: DrawParticipant): number => {
      const v = keyValue(p, key);
      return v === null ? 0 : (counts.get(v) ?? 0);
    };
  });
  const rank = new Map(shuffled.map((p, i) => [p.entryId, i]));
  return [...shuffled].sort((a, b) => {
    for (const size of sizes) {
      const d = size(b) - size(a);
      if (d !== 0) return d;
    }
    return (rank.get(a.entryId) ?? 0) - (rank.get(b.entryId) ?? 0);
  });
}

function eliminationLayout(input: DrawInput, size: number, prng: Prng): DrawLayout {
  const rounds = eliminationRounds(size);
  const placement = new Placement(rounds, input.separation);
  const bySeed = seedPositions(size);
  const byes = new Set(byePositions(size, input.participants.length));
  for (const p of input.participants)
    if (p.seedNumber !== null) placement.place(p, bySeed[p.seedNumber - 1] ?? 0);
  const free: number[] = [];
  for (let position = 1; position <= size; position++)
    if (!byes.has(position) && !placement.at(position)) free.push(position);
  const unseeded = shuffle(
    input.participants.filter((p) => p.seedNumber === null),
    prng,
  );
  const movable: number[] = [];
  for (const p of placementOrder(input, unseeded)) {
    let best: number[] = [];
    let bestScore: number[] | null = null;
    for (const position of free) {
      const score = placement.penalty(p, position);
      const cmp = bestScore === null ? -1 : compareVectors(score, bestScore);
      if (cmp < 0) {
        best = [position];
        bestScore = score;
      } else if (cmp === 0) best.push(position);
    }
    const chosen = best[prng.nextInt(best.length)] as number;
    placement.place(p, chosen);
    free.splice(free.indexOf(chosen), 1);
    movable.push(chosen);
  }
  movable.sort((a, b) => a - b);
  for (let pass = 0; pass < IMPROVEMENT_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < movable.length; i++)
      for (let j = i + 1; j < movable.length; j++)
        if (placement.trySwap(movable[i] as number, movable[j] as number)) changed = true;
    if (!changed) break;
  }
  const slots: DrawSlotSpec[] = [];
  for (let position = 1; position <= size; position++) {
    const p = placement.at(position);
    slots.push({
      position,
      entryId: p?.entryId ?? null,
      seedNumber: p?.seedNumber ?? null,
      pool: poolOfPosition(input.format, size, position),
    });
  }
  const positions = new Map(placement.entries().map(([pos, p]) => [p.entryId, pos]));
  return {
    size,
    slots,
    separation: separationReport(input.participants, positions, input.separation, rounds),
  };
}
