// Ручные перестановки черновика жеребьёвки (правки 09.11.2026, п. 3): администратор меняет местами двух спортсменов
// (или спортсмена и свободную позицию). Подгруппа остаётся за позицией, участник и номер посева переходят вместе.
// Перестановки хранятся по порядку, чтобы проверка воспроизводимости повторила их после расстановки по seed.
import type { DrawSwap } from '@sde/contracts';

export interface SwappableSlot {
  position: number;
  entryId: string | null;
  seedNumber: number | null;
  pool: string | null;
}

/** Сохранённые перестановки (JSON) → список; неверные элементы отбрасываются. */
export function parseSwaps(raw: unknown): DrawSwap[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const v = x as { a?: unknown; b?: unknown };
    return typeof v?.a === 'number' && typeof v?.b === 'number' && v.a !== v.b ? [{ a: v.a, b: v.b }] : [];
  });
}

/** Перестановки по порядку; позиции, которых нет, пропускаются. Исходный массив не меняется. */
export function applySwaps<T extends SwappableSlot>(slots: readonly T[], swaps: readonly DrawSwap[]): T[] {
  const out = slots.map((s) => ({ ...s }));
  for (const { a, b } of swaps) {
    const x = out.find((s) => s.position === a);
    const y = out.find((s) => s.position === b);
    if (!x || !y) continue;
    [x.entryId, y.entryId] = [y.entryId, x.entryId];
    [x.seedNumber, y.seedNumber] = [y.seedNumber, x.seedNumber];
  }
  return out;
}
