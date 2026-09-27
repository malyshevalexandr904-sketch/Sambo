// Форматы соревнований (ARCHITECTURE.md, 14.4): что умеет жеребьёвка, размер сетки и подгруппы.
// Общие для API (жеребьёвка, сетки) и веба (выбор формата, подписи): одна функция — один результат.
import type { CompetitionFormatCode, RuleSetParametersV1 } from './rulesets.js';

/** Форматы Phase 5a. Остальные коды каталога (5b) выбираются правилами, но жеребьёвка их пока не строит. */
export const DRAW_FORMATS = ['ROUND_ROBIN', 'SINGLE_ELIMINATION', 'ELIMINATION_WITH_REPECHAGE'] as const;
export type DrawFormat = (typeof DRAW_FORMATS)[number];

export function isDrawFormat(code: string | null | undefined): code is DrawFormat {
  return (DRAW_FORMATS as readonly string[]).includes(code ?? '');
}

/** Форматы на выбывание: сетка размером в степень двойки, недостающие места — BYE. */
export function isEliminationFormat(format: CompetitionFormatCode): boolean {
  return format === 'SINGLE_ELIMINATION' || format === 'ELIMINATION_WITH_REPECHAGE';
}

/** Минимальная степень двойки не меньше n (не меньше 2). */
export function nextPowerOfTwo(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/** Число позиций жеребьёвки: выбывание — степень двойки (с BYE), круговая система — по числу участников. */
export function drawSize(format: CompetitionFormatCode, participants: number): number {
  return isEliminationFormat(format) ? nextPowerOfTwo(participants) : participants;
}

export type Pool = 'A' | 'B';

/** Подгруппа позиции: в выбывании с утешительными — половины сетки (A — верхняя, B — нижняя). */
export function poolOfPosition(format: CompetitionFormatCode, size: number, position: number): Pool | null {
  if (format !== 'ELIMINATION_WITH_REPECHAGE' || size < 4) return null;
  return position <= size / 2 ? 'A' : 'B';
}

/** Число кругов основной сетки на выбывание: log2 размера. */
export function eliminationRounds(size: number): number {
  return Math.round(Math.log2(size));
}

/**
 * Формат по числу участников (RuleSetParametersV1.formatSelection): диапазоны идут подряд с 2, последний открыт.
 * Меньше двух участников — формата нет.
 */
export function formatForCount(
  selection: RuleSetParametersV1['formatSelection'],
  participants: number,
): CompetitionFormatCode | null {
  const row = selection.find(
    (r) =>
      participants >= r.minParticipants && (r.maxParticipants === null || participants <= r.maxParticipants),
  );
  return row?.format ?? null;
}

/**
 * Круг встречи двух позиций сетки на выбывание (позиции с 1): 1 — первый круг, log2(size) — финал.
 * Чем позже встреча, тем лучше разведены спортсмены.
 */
export function meetingRound(a: number, b: number): number {
  let x = (a - 1) ^ (b - 1);
  let round = 0;
  while (x > 0) {
    round += 1;
    x >>= 1;
  }
  return round;
}

/** Коды подписей кругов (переводятся в вебе): финал, полуфинал, …, утешительные, за 3-е место, круговая. */
export const ROUND_LABELS = [
  'FINAL',
  'SEMIFINAL',
  'QUARTERFINAL',
  'ROUND_OF_16',
  'ROUND_OF_32',
  'ROUND_OF_64',
  'ROUND_OF_128',
  'ROUND_OF_256',
  'REPECHAGE',
  'BRONZE',
  'ROUND_ROBIN',
] as const;
export type RoundLabel = (typeof ROUND_LABELS)[number];

/** Подпись круга основной сетки по числу мест в нём: 2 — финал, 4 — полуфинал, 8 — четвертьфинал. */
export function eliminationRoundLabel(size: number, round: number): RoundLabel {
  const places = size / 2 ** (round - 1);
  if (places <= 2) return 'FINAL';
  if (places === 4) return 'SEMIFINAL';
  if (places === 8) return 'QUARTERFINAL';
  const label = `ROUND_OF_${places}`;
  return (ROUND_LABELS as readonly string[]).includes(label) ? (label as RoundLabel) : 'ROUND_OF_256';
}
