// Вымышленные спортсмены, представители, справочники Phase 3. Совпадения с реальными людьми случайны.
// Весовые категории и возрастные группы — иллюстративные: утверждает положение о соревнованиях.
import { SEED_IDS } from './data';

const id = (block: string, n: number): string => `01920000-0000-7000-${block}-${String(n).padStart(12, '0')}`;

export const P3 = {
  athletePerson: (n: number) => id('8005', n),
  athlete: (n: number) => id('8006', n),
  membership: (n: number) => id('8007', n),
  coachLink: (n: number) => id('8008', n),
  rank: (n: number) => id('8009', n),
  guardianPerson: (n: number) => id('800a', n),
  guardian: (n: number) => id('800b', n),
  consentTemplate: (n: number) => id('800c', n),
  consent: (n: number) => id('800d', n),
  coach: (n: number) => id('800e', n),
  coachMembership: (n: number) => id('800f', n),
  referee: (n: number) => id('8010', n),
  ruleSet: id('8011', 1),
  ruleSetVersion: id('8011', 2),
  ageGroup: (n: number) => id('8012', n),
  weight: (n: number) => id('8013', n),
  categoryTemplate: id('8014', 1),
} as const;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Публичный номер спортсмена seed: 12 символов base58, фиксированный. */
export const seedPublicId = (n: number): string =>
  `SEEDATHL${BASE58[Math.floor(n / 33) % 33]}${BASE58[n % 33]}ZZ`;

export interface SeedAthlete {
  n: number;
  lastName: string;
  firstName: string;
  middleName: string;
  birthDate: string;
  gender: 'MALE' | 'FEMALE';
  club: string;
  coach: 1 | 2;
  rank?: { code: string; assignedAt: string; orderRef: string };
}

const S = SEED_IDS.clubSambo;
const V = SEED_IDS.clubVityaz;

export const SEED_ATHLETES: SeedAthlete[] = [
  {
    n: 1,
    lastName: 'Орлов',
    firstName: 'Дмитрий',
    middleName: 'Андреевич',
    birthDate: '2012-03-15',
    gender: 'MALE',
    club: S,
    coach: 1,
    rank: { code: 'YOUTH_1', assignedAt: '2025-04-10', orderRef: '№ 12-р' },
  },
  {
    n: 2,
    lastName: 'Соколова',
    firstName: 'Алина',
    middleName: 'Игоревна',
    birthDate: '2013-07-02',
    gender: 'FEMALE',
    club: S,
    coach: 1,
    rank: { code: 'YOUTH_2', assignedAt: '2025-04-10', orderRef: '№ 12-р' },
  },
  {
    n: 3,
    lastName: 'Лебедев',
    firstName: 'Артём',
    middleName: 'Сергеевич',
    birthDate: '2011-11-21',
    gender: 'MALE',
    club: S,
    coach: 1,
    rank: { code: 'SPORT_3', assignedAt: '2025-12-01', orderRef: '№ 48-р' },
  },
  {
    n: 4,
    lastName: 'Кузнецова',
    firstName: 'Полина',
    middleName: 'Олеговна',
    birthDate: '2012-01-30',
    gender: 'FEMALE',
    club: S,
    coach: 1,
  },
  {
    n: 5,
    lastName: 'Морозов',
    firstName: 'Кирилл',
    middleName: 'Павлович',
    birthDate: '2014-05-09',
    gender: 'MALE',
    club: S,
    coach: 1,
    rank: { code: 'YOUTH_3', assignedAt: '2026-03-01', orderRef: '№ 7-р' },
  },
  {
    n: 6,
    lastName: 'Волкова',
    firstName: 'Дарья',
    middleName: 'Максимовна',
    birthDate: '2013-09-18',
    gender: 'FEMALE',
    club: S,
    coach: 1,
  },
  {
    n: 7,
    lastName: 'Зайцев',
    firstName: 'Максим',
    middleName: 'Ильич',
    birthDate: '2012-08-04',
    gender: 'MALE',
    club: S,
    coach: 1,
    rank: { code: 'YOUTH_1', assignedAt: '2025-10-15', orderRef: '№ 40-р' },
  },
  {
    n: 8,
    lastName: 'Павлова',
    firstName: 'Ксения',
    middleName: 'Денисовна',
    birthDate: '2011-04-27',
    gender: 'FEMALE',
    club: S,
    coach: 1,
    rank: { code: 'SPORT_3', assignedAt: '2025-12-01', orderRef: '№ 48-р' },
  },
  {
    n: 9,
    lastName: 'Семёнов',
    firstName: 'Егор',
    middleName: 'Романович',
    birthDate: '2014-02-12',
    gender: 'MALE',
    club: S,
    coach: 1,
  },
  {
    n: 10,
    lastName: 'Голубева',
    firstName: 'Виктория',
    middleName: 'Антоновна',
    birthDate: '2012-12-05',
    gender: 'FEMALE',
    club: S,
    coach: 1,
  },
  {
    n: 11,
    lastName: 'Виноградов',
    firstName: 'Тимофей',
    middleName: 'Евгеньевич',
    birthDate: '2013-06-23',
    gender: 'MALE',
    club: S,
    coach: 1,
    rank: { code: 'YOUTH_2', assignedAt: '2025-04-10', orderRef: '№ 12-р' },
  },
  {
    n: 12,
    lastName: 'Богданова',
    firstName: 'Ульяна',
    middleName: 'Витальевна',
    birthDate: '2011-10-14',
    gender: 'FEMALE',
    club: S,
    coach: 1,
  },
  {
    n: 13,
    lastName: 'Воробьёв',
    firstName: 'Никита',
    middleName: 'Олегович',
    birthDate: '2012-05-19',
    gender: 'MALE',
    club: V,
    coach: 2,
    rank: { code: 'YOUTH_1', assignedAt: '2025-05-20', orderRef: '№ 3/25' },
  },
  {
    n: 14,
    lastName: 'Фёдорова',
    firstName: 'Софья',
    middleName: 'Артёмовна',
    birthDate: '2013-03-08',
    gender: 'FEMALE',
    club: V,
    coach: 2,
  },
  {
    n: 15,
    lastName: 'Михайлов',
    firstName: 'Лев',
    middleName: 'Дмитриевич',
    birthDate: '2011-07-29',
    gender: 'MALE',
    club: V,
    coach: 2,
    rank: { code: 'SPORT_2', assignedAt: '2026-02-14', orderRef: '№ 5/26' },
  },
  {
    n: 16,
    lastName: 'Белова',
    firstName: 'Мария',
    middleName: 'Кирилловна',
    birthDate: '2014-01-16',
    gender: 'FEMALE',
    club: V,
    coach: 2,
  },
  {
    n: 17,
    lastName: 'Тарасов',
    firstName: 'Матвей',
    middleName: 'Алексеевич',
    birthDate: '2012-10-02',
    gender: 'MALE',
    club: V,
    coach: 2,
  },
  {
    n: 18,
    lastName: 'Комарова',
    firstName: 'Ева',
    middleName: 'Николаевна',
    birthDate: '2013-12-11',
    gender: 'FEMALE',
    club: V,
    coach: 2,
    rank: { code: 'YOUTH_3', assignedAt: '2026-03-01', orderRef: '№ 4/26' },
  },
  {
    n: 19,
    lastName: 'Киселёв',
    firstName: 'Глеб',
    middleName: 'Юрьевич',
    birthDate: '2014-08-30',
    gender: 'MALE',
    club: V,
    coach: 2,
  },
  {
    n: 20,
    lastName: 'Орлова',
    firstName: 'Варвара',
    middleName: 'Андреевна',
    birthDate: '2011-02-03',
    gender: 'FEMALE',
    club: V,
    coach: 2,
    rank: { code: 'SPORT_3', assignedAt: '2025-11-11', orderRef: '№ 9/25' },
  },
];

/**
 * Представители: первый — пользователь parent1 (подтверждён, согласия не даны — даёт их в кабинете),
 * остальные — без аккаунта, согласия даны электронно.
 */
export const SEED_GUARDIANS: {
  n: number;
  athlete: number;
  person: {
    lastName: string;
    firstName: string;
    middleName: string;
    birthDate: string;
    gender: 'MALE' | 'FEMALE';
  } | null;
  relation: 'MOTHER' | 'FATHER';
  consents: boolean;
}[] = [
  { n: 1, athlete: 1, person: null, relation: 'MOTHER', consents: false },
  {
    n: 2,
    athlete: 2,
    person: {
      lastName: 'Соколов',
      firstName: 'Игорь',
      middleName: 'Петрович',
      birthDate: '1983-02-11',
      gender: 'MALE',
    },
    relation: 'FATHER',
    consents: true,
  },
  {
    n: 3,
    athlete: 3,
    person: {
      lastName: 'Лебедева',
      firstName: 'Наталья',
      middleName: 'Викторовна',
      birthDate: '1985-06-30',
      gender: 'FEMALE',
    },
    relation: 'MOTHER',
    consents: true,
  },
  {
    n: 4,
    athlete: 13,
    person: {
      lastName: 'Воробьёва',
      firstName: 'Ирина',
      middleName: 'Алексеевна',
      birthDate: '1987-09-05',
      gender: 'FEMALE',
    },
    relation: 'MOTHER',
    consents: true,
  },
];

export const SEED_CONSENT_OPERATOR = 'Учебная федерация самбо (вымышленный оператор персональных данных)';
export const SEED_CONSENT_OPERATOR_EN = 'Training Sambo Federation (fictional personal data operator)';

const DEMO_NOTE_RU =
  '\n\n_Учебный текст для демонстрации. Не является юридически выверенной формой согласия: перед запуском текст утверждает юрист оператора._';
const DEMO_NOTE_EN =
  '\n\n_Demonstration text. Not a legally reviewed consent form: the operator’s lawyer approves the text before launch._';

export const SEED_CONSENT_TEXTS: {
  kind: 'PD_PROCESSING' | 'PD_DISTRIBUTION' | 'HEALTH_DATA';
  ru: string;
  en: string;
}[] = [
  {
    kind: 'PD_PROCESSING',
    ru:
      '## Согласие на обработку персональных данных\n\nЯ даю согласие оператору на обработку персональных данных спортсмена (фамилия, имя, отчество, дата рождения, пол, клуб, тренер, спортивный разряд, результаты выступлений) в целях организации и проведения соревнований по самбо, ведения протоколов и учёта спортивных результатов.\n\nСогласие действует до его отзыва. Отозвать согласие можно в личном кабинете или письменным заявлением оператору.' +
      DEMO_NOTE_RU,
    en:
      '## Consent to personal data processing\n\nI consent to the operator processing the athlete’s personal data (full name, date of birth, gender, club, coach, sports rank, competition results) to organise and run sambo competitions, keep records and account for sports results.\n\nThe consent is valid until revoked. It can be revoked in the personal account or by a written request to the operator.' +
      DEMO_NOTE_EN,
  },
  {
    kind: 'PD_DISTRIBUTION',
    ru:
      '## Согласие на распространение персональных данных\n\nЯ разрешаю публиковать в открытом доступе фамилию и инициалы спортсмена, год рождения, клуб, регион и результаты выступлений: в стартовых листах, сетках, протоколах и рейтингах соревнований.\n\nДата рождения полностью, документы и контакты не публикуются. Согласие действует до его отзыва.' +
      DEMO_NOTE_RU,
    en:
      '## Consent to publishing personal data\n\nI allow publishing the athlete’s last name and initials, year of birth, club, region and results in start lists, brackets, protocols and ratings.\n\nThe full date of birth, documents and contacts are never published. The consent is valid until revoked.' +
      DEMO_NOTE_EN,
  },
  {
    kind: 'HEALTH_DATA',
    ru:
      '## Согласие на обработку сведений о состоянии здоровья\n\nЯ даю согласие на обработку сведений о допуске спортсмена к соревнованиям по состоянию здоровья (медицинская справка, отметки врача соревнований) исключительно для допуска и медицинского обеспечения соревнований.\n\nСведения доступны только уполномоченным лицам. Согласие действует до его отзыва.' +
      DEMO_NOTE_RU,
    en:
      '## Consent to processing health data\n\nI consent to processing information on the athlete’s medical clearance for competitions (medical certificate, competition doctor’s notes) solely for admission and medical support of competitions.\n\nThe information is available to authorised persons only. The consent is valid until revoked.' +
      DEMO_NOTE_EN,
  },
];

export const SEED_AGE_GROUPS: {
  n: number;
  code: string;
  nameRu: string;
  nameEn: string;
  ageFrom: number;
  ageTo: number;
  weights: { MALE: number[]; FEMALE: number[] };
}[] = [
  {
    n: 1,
    code: 'Y12_14',
    nameRu: 'Юноши и девушки 12–14 лет',
    nameEn: 'Boys and girls 12–14',
    ageFrom: 12,
    ageTo: 14,
    weights: { MALE: [35, 38, 42, 46, 50, 55, 60, 66, 72], FEMALE: [32, 35, 38, 41, 44, 47, 51, 55, 59] },
  },
  {
    n: 2,
    code: 'Y14_16',
    nameRu: 'Юноши и девушки 14–16 лет',
    nameEn: 'Boys and girls 14–16',
    ageFrom: 14,
    ageTo: 16,
    weights: { MALE: [42, 46, 50, 55, 60, 66, 72, 79], FEMALE: [38, 41, 44, 47, 51, 55, 59, 65] },
  },
];
