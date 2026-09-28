// Посев и BYE (ARCHITECTURE.md, 14.5, шаг 3): стандартный порядок посева сетки на выбывание. Посеянные №1 и №2
// в разных половинах, №1–4 — в разных четвертях и т. д.; BYE получают сильнейшие посевы, поэтому они распределены
// равномерно по половинам и четвертям и никогда не встречаются друг с другом.

/**
 * Номер посева на каждой позиции сетки размера size (степень двойки): result[position − 1] = номер посева.
 * В первом круге встречаются посевы k и size + 1 − k.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((seed) => [seed, next + 1 - seed]);
  }
  return order;
}

/** Позиция каждого номера посева: result[seed − 1] = позиция (с 1). */
export function seedPositions(size: number): number[] {
  const bySeed = new Array<number>(size).fill(0);
  seedOrder(size).forEach((seed, i) => {
    bySeed[seed - 1] = i + 1;
  });
  return bySeed;
}

/**
 * Позиции BYE при n участниках в сетке size: места посевов n + 1 … size, то есть соперники посевов 1 … size − n.
 * Так BYE стоят против разных участников, по одному в паре первого круга.
 */
export function byePositions(size: number, participants: number): number[] {
  const bySeed = seedPositions(size);
  const out: number[] = [];
  for (let seed = participants + 1; seed <= size; seed++) out.push(bySeed[seed - 1] ?? 0);
  return out.sort((a, b) => a - b);
}
