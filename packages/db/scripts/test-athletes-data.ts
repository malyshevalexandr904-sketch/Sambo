// Данные тестовых спортсменов (test-athletes.ts и apps/api/scripts/test-athletes-enter.ts): 87 вымышленных юношей
// 2012 г. р. в четырёх весовых категориях — 41, 27, 11 и 8 человек (разная величина сеток). Вес хранится не у
// спортсмена, а в заявке на турнир: плановый вес здесь, его подставляет команда enter или вводят вручную.

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const MARK = 'TESTATHL';
export const testPublicId = (n: number): string => `${MARK}${BASE58[Math.floor(n / 58)]}${BASE58[n % 58]}ZZ`;

export interface TestAthlete {
  n: number;
  lastName: string;
  firstName: string;
  middleName: string;
  gender: 'MALE';
  /** Весовая категория «до, кг» (есть в группах 12–14 и 14–16 лет) и плановый вес, кг. */
  category: number;
  weight: number;
}

/** Категории: верхняя граница, нижняя (предыдущая категория) и сколько в ней спортсменов. */
const CATEGORIES = [
  { upTo: 50, from: 46, count: 41 },
  { upTo: 55, from: 50, count: 27 },
  { upTo: 60, from: 55, count: 11 },
  { upTo: 66, from: 60, count: 8 },
];

// 30 фамилий и 29 имён: пара (n mod 30, n mod 29) не повторяется для первых 870 номеров — ФИО все разные.
const LAST = [
  'Абрамов',
  'Белов',
  'Васильев',
  'Гаврилов',
  'Данилов',
  'Ершов',
  'Жуков',
  'Зайцев',
  'Ильин',
  'Карпов',
  'Лебедев',
  'Макаров',
  'Назаров',
  'Осипов',
  'Павлов',
  'Рябов',
  'Семёнов',
  'Тихонов',
  'Уваров',
  'Фролов',
  'Харитонов',
  'Царёв',
  'Чернов',
  'Шестаков',
  'Щербаков',
  'Юдин',
  'Яковлев',
  'Афанасьев',
  'Борисов',
  'Голубев',
];
const FIRST = [
  'Никита',
  'Артём',
  'Егор',
  'Матвей',
  'Иван',
  'Тимофей',
  'Максим',
  'Глеб',
  'Даниил',
  'Кирилл',
  'Арсений',
  'Лев',
  'Марк',
  'Фёдор',
  'Ярослав',
  'Михаил',
  'Александр',
  'Роман',
  'Степан',
  'Савелий',
  'Захар',
  'Богдан',
  'Илья',
  'Георгий',
  'Платон',
  'Святослав',
  'Демид',
  'Всеволод',
  'Тимур',
];
const MIDDLE = [
  'Сергеевич',
  'Игоревич',
  'Дмитриевич',
  'Андреевич',
  'Олегович',
  'Павлович',
  'Алексеевич',
  'Викторович',
  'Романович',
  'Евгеньевич',
  'Николаевич',
  'Михайлович',
  'Юрьевич',
];

export const TEST_ATHLETES: TestAthlete[] = CATEGORIES.flatMap((c, ci) =>
  Array.from({ length: c.count }, (_, i) => ({ category: c.upTo, from: c.from, i, ci })),
).map(({ category, from, i }, k) => {
  const n = k + 1;
  // Плановый вес внутри категории: от нижней границы + 0,3 кг до верхней, разный у всех.
  const span = category - from - 0.4;
  const weight = Math.round((from + 0.3 + ((i * 0.37) % span)) * 10) / 10;
  return {
    n,
    lastName: LAST[n % LAST.length] as string,
    firstName: FIRST[n % FIRST.length] as string,
    middleName: MIDDLE[n % MIDDLE.length] as string,
    gender: 'MALE' as const,
    category,
    weight,
  };
});

export const testBirthDate = (n: number): Date => new Date(Date.UTC(2012, (n * 5) % 12, ((n * 7) % 27) + 1));
