// Формат рейтингового турнира SPECIAL_GROUP_RATED (docs/RATED_TOURNAMENT_FORMAT.md): подгруппы по кругу, из них —
// в финальную часть на выбывание. Правила по числу участников, схемы кругов подгрупп и пары финальной части —
// данные версии формата («СССамбо Схема групп на турнир.xlsx»), а не ветки по числу участников. Общие для API
// (жеребьёвка, проверка) и веба (план категории).
import { z } from 'zod';

/** Буквы подгрупп по порядку: в документах — А, Б, В, Г, Д, Е, Ж, З (подписи переводятся в вебе). */
export const RATED_GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type RatedGroupLetter = (typeof RATED_GROUP_LETTERS)[number];

/** Участник финальной части: «A1» — первое место подгруппы A. */
const QualifierRef = z.string().regex(/^[A-H][1-9]$/, { error: 'invalid_qualifier' });
/** Пара схемы круга: позиции в подгруппе (1 — высший посев), первая — красный угол. */
const Pair = z.tuple([z.number().int().min(1), z.number().int().min(1)]);

/** Правило для диапазона числа участников (RatedTournamentFormatRule, ТЗ 35). */
export const RatedFormatRule = z.strictObject({
  minParticipants: z.number().int().min(1),
  maxParticipants: z.number().int().min(1),
  groupCount: z.number().int().min(1).max(RATED_GROUP_LETTERS.length),
  /** Выходят из каждой подгруппы в финальную часть; 0 — финальной части нет (одна подгруппа — круговая). */
  qualifiersPerGroup: z.number().int().min(0).max(9),
  /** Участников финальной части (степень двойки); 0 — нет. */
  finalBracketSize: z.number().int().min(0),
  /** Пары первого круга финальной части; соседние пары сходятся в следующем круге. */
  finalPairing: z.array(z.tuple([QualifierRef, QualifierRef])).default([]),
});
export type RatedFormatRule = z.infer<typeof RatedFormatRule>;

const isPowerOfTwo = (n: number): boolean => n >= 2 && (n & (n - 1)) === 0;
const groupIndex = (ref: string): number => RATED_GROUP_LETTERS.indexOf(ref[0] as RatedGroupLetter);

/** Ошибки согласованности правила; пусто — правило корректно. */
function ruleIssues(r: RatedFormatRule): string[] {
  const issues: string[] = [];
  if (r.minParticipants > r.maxParticipants) issues.push('range_invalid');
  if (r.groupCount === 1) {
    if (r.qualifiersPerGroup !== 0 || r.finalBracketSize !== 0 || r.finalPairing.length > 0)
      issues.push('single_group_has_final');
    return issues;
  }
  if (r.qualifiersPerGroup < 1) issues.push('qualifiers_missing');
  if (r.groupCount * r.qualifiersPerGroup !== r.finalBracketSize) issues.push('final_size_mismatch');
  if (!isPowerOfTwo(r.finalBracketSize)) issues.push('final_size_not_power_of_two');
  if (r.finalPairing.length * 2 !== r.finalBracketSize) issues.push('final_pairing_size');
  const refs = r.finalPairing.flat();
  if (new Set(refs).size !== refs.length) issues.push('final_pairing_duplicate');
  for (const ref of refs) {
    const g = groupIndex(ref);
    if (g < 0 || g >= r.groupCount || Number(ref.slice(1)) > r.qualifiersPerGroup)
      issues.push('final_pairing_unknown_qualifier');
  }
  // Подгруппа — не меньше 3 участников: полный круг даёт каждому хотя бы 2 схватки.
  if (Math.floor(r.minParticipants / r.groupCount) < 3) issues.push('group_too_small');
  return issues;
}

/** Полная схема круговой подгруппы размера n: каждая пара позиций ровно один раз, позиция — раз за круг. */
function scheduleIssues(size: number, rounds: [number, number][][]): string[] {
  const seen = new Set<string>();
  for (const round of rounds) {
    const inRound = new Set<number>();
    for (const [a, b] of round) {
      if (a === b || a > size || b > size) return ['schedule_position_invalid'];
      if (inRound.has(a) || inRound.has(b)) return ['schedule_position_twice_in_round'];
      inRound.add(a).add(b);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) return ['schedule_pair_repeated'];
      seen.add(key);
    }
  }
  return seen.size === (size * (size - 1)) / 2 ? [] : ['schedule_incomplete'];
}

/**
 * Критерии мест в подгруппе (ТЗ 31, GroupStandingRules), применяются по порядку к равным:
 * - WINS — число побед в подгруппе;
 * - HEAD_TO_HEAD — победы во встречах между равными (заново для каждой меньшей группы равных);
 * - CLEAN_WINS — чистые победы: чистая победа, а также неявка, снятие, травма, дисквалификация соперника
 *   (решение заказчика 2026-10-18);
 * - SUPERIORITY_WINS — победы за явным преимуществом.
 * Неразрешённое равенство — общее место.
 */
export const GROUP_STANDING_CRITERIA = ['WINS', 'HEAD_TO_HEAD', 'CLEAN_WINS', 'SUPERIORITY_WINS'] as const;
export type GroupStandingCriterion = (typeof GROUP_STANDING_CRITERIA)[number];

export const GroupStandingRules = z.strictObject({
  criteria: z
    .array(z.enum(GROUP_STANDING_CRITERIA))
    .min(1)
    .refine((c) => new Set(c).size === c.length, { error: 'duplicate_criterion' }),
  /**
   * Критерии подтверждены заказчиком. В источниках правила мест в подгруппе нет (docs/RATED_TOURNAMENT_FORMAT.md,
   * 3; Q-F4): пока false — по умолчанию как места круговой системы, решение заказчика требуется.
   */
  confirmed: z.boolean(),
});
export type GroupStandingRules = z.infer<typeof GroupStandingRules>;

/** Версия формата: правила по числу участников подряд, схемы кругов для всех возможных размеров подгрупп. */
export const RatedFormatConfig = z
  .strictObject({
    code: z.string().regex(/^[a-z0-9-]{3,40}$/),
    rules: z.array(RatedFormatRule).min(1),
    /** Схема кругов по размеру подгруппы: `roundSchedules["4"]` — круги подгруппы из 4. */
    roundSchedules: z.record(z.string().regex(/^[1-9]\d?$/), z.array(z.array(Pair).min(1)).min(1)),
    /** Распределение по подгруппам: змейка по номерам посева (ТЗ 29). */
    distribution: z.literal('SNAKE'),
    /** Схватки за 3 место нет: оба проигравших полуфиналиста — 3 место. */
    thirdPlace: z.literal('BOTH_SEMIFINAL_LOSERS'),
    groupStandingRules: GroupStandingRules,
  })
  .superRefine((cfg, ctx) => {
    cfg.rules.forEach((r, i) => {
      for (const issue of ruleIssues(r)) ctx.addIssue({ code: 'custom', path: ['rules', i], message: issue });
      const prev = cfg.rules[i - 1];
      if (prev && r.minParticipants !== prev.maxParticipants + 1)
        ctx.addIssue({ code: 'custom', path: ['rules', i], message: 'ranges_not_contiguous' });
      // Для каждого размера подгруппы этого правила есть схема кругов.
      const smallest = Math.floor(r.minParticipants / r.groupCount);
      const largest = Math.ceil(r.maxParticipants / r.groupCount);
      for (let size = smallest; size <= largest; size++)
        if (!cfg.roundSchedules[String(size)])
          ctx.addIssue({ code: 'custom', path: ['rules', i], message: `schedule_missing_${size}` });
    });
    for (const [size, rounds] of Object.entries(cfg.roundSchedules))
      for (const issue of scheduleIssues(Number(size), rounds))
        ctx.addIssue({ code: 'custom', path: ['roundSchedules', size], message: issue });
  });
export type RatedFormatConfig = z.infer<typeof RatedFormatConfig>;

/**
 * Начальная версия формата (docs/RATED_TOURNAMENT_FORMAT.md, 1, 5; лист 1 «Схема групп»). 40 и более участников
 * пока не поддерживаются (решение заказчика 2026-10-18).
 */
export const RATED_GROUPS_V1: RatedFormatConfig = RatedFormatConfig.parse({
  code: 'rated-groups-v1',
  rules: [
    { minParticipants: 3, maxParticipants: 5, groupCount: 1, qualifiersPerGroup: 0, finalBracketSize: 0 },
    {
      minParticipants: 6,
      maxParticipants: 11,
      groupCount: 2,
      qualifiersPerGroup: 2,
      finalBracketSize: 4,
      finalPairing: [
        ['A1', 'B2'],
        ['B1', 'A2'],
      ],
    },
    {
      minParticipants: 12,
      maxParticipants: 23,
      groupCount: 4,
      qualifiersPerGroup: 2,
      finalBracketSize: 8,
      finalPairing: [
        ['A1', 'B2'],
        ['C1', 'D2'],
        ['B1', 'A2'],
        ['D1', 'C2'],
      ],
    },
    {
      minParticipants: 24,
      maxParticipants: 39,
      groupCount: 8,
      qualifiersPerGroup: 1,
      finalBracketSize: 8,
      finalPairing: [
        ['A1', 'B1'],
        ['C1', 'D1'],
        ['E1', 'F1'],
        ['G1', 'H1'],
      ],
    },
  ],
  roundSchedules: {
    '3': [[[1, 2]], [[1, 3]], [[3, 2]]],
    '4': [
      [
        [1, 2],
        [4, 3],
      ],
      [
        [1, 3],
        [2, 4],
      ],
      [
        [1, 4],
        [3, 2],
      ],
    ],
    '5': [
      [
        [1, 2],
        [5, 4],
      ],
      [
        [1, 3],
        [2, 4],
      ],
      [
        [1, 4],
        [3, 5],
      ],
      [
        [1, 5],
        [3, 2],
      ],
      [
        [5, 2],
        [4, 3],
      ],
    ],
    '6': [
      [
        [1, 2],
        [6, 3],
        [5, 4],
      ],
      [
        [1, 3],
        [2, 4],
        [6, 5],
      ],
      [
        [1, 4],
        [3, 5],
        [2, 6],
      ],
      [
        [1, 5],
        [4, 6],
        [3, 2],
      ],
      [
        [1, 6],
        [5, 2],
        [4, 3],
      ],
    ],
  },
  distribution: 'SNAKE',
  thirdPlace: 'BOTH_SEMIFINAL_LOSERS',
  // TODO(Q-F4): решение заказчика — пока как места круговой системы платформы.
  groupStandingRules: {
    criteria: ['WINS', 'HEAD_TO_HEAD', 'CLEAN_WINS', 'SUPERIORITY_WINS'],
    confirmed: false,
  },
});

/**
 * Номера посева по подгруппам змейкой (ТЗ 29): посевы 1…g — в подгруппы A…, следующие g — в обратном порядке, и так
 * далее. Внутри подгруппы — по возрастанию номера посева.
 */
export function snakeGroups(participants: number, groupCount: number): number[][] {
  const groups: number[][] = Array.from({ length: groupCount }, () => []);
  for (let seed = 1; seed <= participants; seed++) {
    const row = Math.floor((seed - 1) / groupCount);
    const col = (seed - 1) % groupCount;
    groups[row % 2 === 0 ? col : groupCount - 1 - col]!.push(seed);
  }
  return groups;
}

export type RatedFormatIssue = 'INSUFFICIENT_PARTICIPANTS' | 'TOO_MANY_PARTICIPANTS';

export interface RatedFormatPlan {
  formatVersion: string;
  participants: number;
  groups: { letter: RatedGroupLetter; size: number; matches: number }[];
  qualifiersPerGroup: number;
  finalBracketSize: number;
  finalPairing: [string, string][];
  groupMatches: number;
  /** Схваток финальной части: без схватки за 3 место. */
  finalMatches: number;
  totalMatches: number;
}

export type RatedFormatPlanResult =
  | { ok: true; plan: RatedFormatPlan }
  | { ok: false; issue: RatedFormatIssue; minParticipants: number; maxParticipants: number };

/** Правило версии формата для числа участников; вне диапазонов — null. */
export function ratedFormatRule(
  participants: number,
  config: RatedFormatConfig = RATED_GROUPS_V1,
): RatedFormatRule | null {
  return (
    config.rules.find((r) => participants >= r.minParticipants && participants <= r.maxParticipants) ?? null
  );
}

/** Схема кругов подгруппы размера `size`: пары позиций (1 — высший посев) по кругам. */
export function ratedRoundSchedule(
  size: number,
  config: RatedFormatConfig = RATED_GROUPS_V1,
): [number, number][][] {
  const rounds = config.roundSchedules[String(size)];
  // Версия формата проверена при загрузке: схема есть для каждого размера подгруппы её правил.
  if (!rounds) throw new Error(`No round schedule for a group of ${size} in ${config.code}`);
  return rounds;
}

/** План категории по числу участников: подгруппы, выход, финальная часть, число схваток. */
export function ratedFormatPlan(
  participants: number,
  config: RatedFormatConfig = RATED_GROUPS_V1,
): RatedFormatPlanResult {
  const min = config.rules[0]!.minParticipants;
  const max = config.rules[config.rules.length - 1]!.maxParticipants;
  const rule = ratedFormatRule(participants, config);
  if (!rule)
    return {
      ok: false,
      issue: participants < min ? 'INSUFFICIENT_PARTICIPANTS' : 'TOO_MANY_PARTICIPANTS',
      minParticipants: min,
      maxParticipants: max,
    };
  const groups = snakeGroups(participants, rule.groupCount).map((seeds, i) => ({
    letter: RATED_GROUP_LETTERS[i]!,
    size: seeds.length,
    matches: (seeds.length * (seeds.length - 1)) / 2,
  }));
  const groupMatches = groups.reduce((n, g) => n + g.matches, 0);
  const finalMatches = rule.finalBracketSize > 0 ? rule.finalBracketSize - 1 : 0;
  return {
    ok: true,
    plan: {
      formatVersion: config.code,
      participants,
      groups,
      qualifiersPerGroup: rule.qualifiersPerGroup,
      finalBracketSize: rule.finalBracketSize,
      finalPairing: rule.finalPairing,
      groupMatches,
      finalMatches,
      totalMatches: groupMatches + finalMatches,
    },
  };
}
