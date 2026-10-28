// Пример расчёта рейтинга для главной (правки 28.10.2026): та же формула, что в packages/rating (docs/RATING_RULES.md),
// но в обычных числах — только для пояснения; настоящий расчёт делает сервер в десятичной арифметике.
/** Исходы для спортсмена A и фактический результат S_A (RATING_RULES.md, 3). */
export const OUTCOMES = [
  { key: 'CLEAN_WIN', s: 1 },
  { key: 'WIN_ON_POINTS', s: 0.9 },
  { key: 'WIN_SMALL_ADVANTAGE', s: 0.7 },
  { key: 'WIN_MINIMAL_ADVANTAGE', s: 0.6 },
  { key: 'LOSS_MINIMAL_ADVANTAGE', s: 0.4 },
  { key: 'LOSS_SMALL_ADVANTAGE', s: 0.3 },
  { key: 'LOSS_ON_POINTS', s: 0.1 },
  { key: 'CLEAN_LOSS', s: 0 },
] as const;

export const kOf = (r: number): number => (r <= 100 ? 60 : r <= 300 ? 30 : 10);
export const expected = (a: number, b: number): number => 1 / (10 ** ((b - a) / 400) + 1);
const roundHalfUp = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
export const levelOf = (r: number): number => Math.min(10, Math.max(1, Math.floor((r - 200) / 200) + 1));

/** Новые рейтинги после схватки: R' = R + K × (S − E), округление до целого (половина — от нуля). */
export function eloAfter(a: number, b: number, sA: number): [number, number] {
  return [
    roundHalfUp(a + kOf(a) * (sA - expected(a, b))),
    roundHalfUp(b + kOf(b) * (1 - sA - expected(b, a))),
  ];
}
