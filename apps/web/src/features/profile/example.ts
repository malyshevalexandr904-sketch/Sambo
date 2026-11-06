// Пример профиля для демо-входа (правки 05.11.2026, п. 5): вымышленный спортсмен, чтобы в демо было видно, как
// выглядит личный кабинет с данными. Это не данные реальных людей (152-ФЗ): имена, клуб и турниры придуманы.
import type { AthleteResultDto, PublicRatingHistoryItem, RatingOutcome } from '@sde/contracts';
import { eloAfter, levelOf } from '@/lib/rating-example';
import type { AthleteStats } from './profile-view';

const S: Record<RatingOutcome, number> = {
  CLEAN_WIN: 1,
  WIN_ON_POINTS: 0.9,
  WIN_SMALL_ADVANTAGE: 0.7,
  WIN_MINIMAL_ADVANTAGE: 0.6,
  LOSS_MINIMAL_ADVANTAGE: 0.4,
  LOSS_SMALL_ADVANTAGE: 0.3,
  LOSS_ON_POINTS: 0.1,
  CLEAN_LOSS: 0,
};

const TOURNAMENTS = [
  { slug: 'autumn-cup', name: 'Осенний кубок «Цифрового самбо»', date: '2026-09-20' },
  { slug: 'city-open', name: 'Открытое первенство клуба «Пример»', date: '2026-10-11' },
  { slug: 'youth-league', name: 'Юношеская лига, 1-й этап', date: '2026-11-01' },
];

const BOUTS: [number, string, number, RatingOutcome][] = [
  [0, 'Орлов Д.', 214, 'WIN_ON_POINTS'],
  [0, 'Белов К.', 236, 'CLEAN_WIN'],
  [0, 'Ершов М.', 268, 'LOSS_SMALL_ADVANTAGE'],
  [1, 'Лаптев Н.', 222, 'CLEAN_WIN'],
  [1, 'Гусев П.', 247, 'WIN_SMALL_ADVANTAGE'],
  [1, 'Фомин А.', 255, 'WIN_ON_POINTS'],
  [1, 'Зуев Р.', 281, 'WIN_MINIMAL_ADVANTAGE'],
  [2, 'Карпов И.', 240, 'CLEAN_WIN'],
  [2, 'Тихонов Е.', 262, 'LOSS_MINIMAL_ADVANTAGE'],
  [2, 'Ершов М.', 274, 'WIN_ON_POINTS'],
];

function bouts(): PublicRatingHistoryItem[] {
  let rating = 200;
  return BOUTS.map(([ti, name, opp, outcome], i) => {
    const tour = TOURNAMENTS[ti]!;
    const [after] = eloAfter(rating, opp, S[outcome]);
    const item: PublicRatingHistoryItem = {
      kind: 'MATCH',
      at: `${tour.date}T${String(10 + (i % 4)).padStart(2, '0')}:30:00.000Z`,
      ratingBefore: rating,
      ratingAfter: after,
      delta: after - rating,
      levelAfter: levelOf(after),
      outcome,
      competition: { slug: tour.slug, name: tour.name },
      opponent: { publicId: null, name, hidden: false, club: null, region: null, ratingBefore: opp },
    };
    rating = after;
    return item;
  });
}

const RESULTS: AthleteResultDto[] = (
  [
    { place: 1, medal: 'GOLD', wins: 2, losses: 1, ti: 2 },
    { place: 1, medal: 'GOLD', wins: 4, losses: 0, ti: 1 },
    { place: 2, medal: 'SILVER', wins: 2, losses: 1, ti: 0 },
  ] as const
).map(({ ti, ...r }) => ({
  ...r,
  competitionId: TOURNAMENTS[ti]!.slug,
  competitionName: TOURNAMENTS[ti]!.name,
  startDate: TOURNAMENTS[ti]!.date,
  endDate: TOURNAMENTS[ti]!.date,
  level: 'CLUB' as const,
  categoryName: { ru: 'Юноши 13–14 лет, до 50 кг', en: 'Boys 13–14, up to 50 kg' },
  clubName: 'Клуб «Пример»',
  status: 'PUBLISHED' as const,
  publishedAt: TOURNAMENTS[ti]!.date,
}));

export function exampleAthleteStats(): AthleteStats {
  const b = bouts();
  const ratings = [b[0]!.ratingBefore, ...b.map((x) => x.ratingAfter)];
  const wins = b.filter((x) => x.delta > 0).length;
  const last = ratings.at(-1)!;
  return {
    rating: {
      rating: last,
      level: levelOf(last),
      peakRating: Math.max(...ratings),
      ratedMatches: b.length,
      wins,
      losses: b.length - wins,
    },
    division: 'Дивизион: Юноши · 13–14 лет',
    bouts: b,
    medals: { GOLD: 2, SILVER: 1, BRONZE: 0 },
    competitions: RESULTS.length,
    results: RESULTS,
  };
}
