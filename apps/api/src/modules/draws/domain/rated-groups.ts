// Подгруппы рейтингового формата SPECIAL_GROUP_RATED (ТЗ 26, 27, 29; docs/RATED_TOURNAMENT_FORMAT.md, 2).
// Посев — место по рейтингу на момент жеребьёвки (1 — высший); равный рейтинг — порядок по seed жеребьёвки
// (воспроизводимо, ADR-11). Подгруппы — змейкой по номерам посева; позиции жеребьёвки идут подгруппа за подгруппой,
// внутри — по возрастанию номера посева. Разведение по клубам и регионам не применяется (Q-F7).
import { RATED_GROUP_LETTERS, type RatedGroupLetter, ratedFormatRule, snakeGroups } from '@sde/contracts';
import type { DrawInput, DrawParticipant } from './draw-input';
import { type Prng, shuffle } from './prng';

export interface RatedSlot {
  position: number;
  entryId: string;
  seedNumber: number;
  pool: RatedGroupLetter;
}

/** Посев по рейтингу: участники по убыванию рейтинга, равные — в порядке перемешивания по seed. */
export function ratedSeedOrder(participants: readonly DrawParticipant[], prng: Prng): DrawParticipant[] {
  const rating = (p: DrawParticipant): number => {
    if (p.rating === undefined) throw new Error(`Rated draw participant ${p.entryId} has no rating`);
    return p.rating;
  };
  // Сортировка устойчива: при равном рейтинге остаётся порядок перемешивания.
  return shuffle(participants, prng).sort((a, b) => rating(b) - rating(a));
}

/** Расстановка рейтингового формата: номер посева, подгруппа и позиция каждого участника. */
export function ratedGroupSlots(input: DrawInput, prng: Prng): RatedSlot[] {
  const n = input.participants.length;
  const rule = ratedFormatRule(n);
  // Число участников проверяет формат до жеребьёвки (INSUFFICIENT_PARTICIPANTS, TOO_MANY_PARTICIPANTS).
  if (!rule) throw new Error(`No rated format rule for ${n} participants`);
  const seeded = ratedSeedOrder(input.participants, prng);
  const slots: RatedSlot[] = [];
  snakeGroups(n, rule.groupCount).forEach((seeds, g) => {
    for (const seedNumber of seeds)
      slots.push({
        position: slots.length + 1,
        entryId: (seeded[seedNumber - 1] as DrawParticipant).entryId,
        seedNumber,
        pool: RATED_GROUP_LETTERS[g] as RatedGroupLetter,
      });
  });
  return slots;
}
