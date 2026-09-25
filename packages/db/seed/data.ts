// Вымышленные данные seed. Совпадения с реальными людьми и организациями случайны.
// Идентификаторы фиксированы, чтобы повторный запуск обновлял те же записи.

export const SEED_IDS = {
  federation: '01920000-0000-7000-8000-000000000001',
  clubSambo: '01920000-0000-7000-8000-000000000002',
  clubVityaz: '01920000-0000-7000-8000-000000000003',
  organizer: '01920000-0000-7000-8000-000000000004',
  /** Учебный турнир «Кубок Юности»: до Phase 4 существует через свой персонал (секретарь). */
  competition: '01920000-0000-7000-8015-000000000001',
} as const;

export interface SeedOrganization {
  id: string;
  type: string;
  parentId: string | null;
  name: string;
  shortName: string;
  slug: string;
  regionCode: string;
  city: string;
  contactEmail: string;
}

export const SEED_ORGANIZATIONS: SeedOrganization[] = [
  {
    id: SEED_IDS.federation,
    type: 'REGIONAL_FEDERATION',
    parentId: null,
    name: 'Федерация самбо Северной области (учебная)',
    shortName: 'ФС Северной обл.',
    slug: 'fs-severnaya',
    regionCode: 'RU-MOS',
    city: 'Северогорск',
    contactEmail: 'federation@sambo.local',
  },
  {
    id: SEED_IDS.clubSambo,
    type: 'SPORTS_SCHOOL',
    parentId: SEED_IDS.federation,
    name: 'Спортивная школа «Самбо-Север» (учебная)',
    shortName: 'СШ «Самбо-Север»',
    slug: 'ssh-sambo-sever',
    regionCode: 'RU-MOS',
    city: 'Северогорск',
    contactEmail: 'school@sambo.local',
  },
  {
    id: SEED_IDS.clubVityaz,
    type: 'CLUB',
    parentId: SEED_IDS.federation,
    name: 'Клуб самбо «Витязь-Учебный»',
    shortName: 'Клуб «Витязь-У»',
    slug: 'klub-vityaz-u',
    regionCode: 'RU-MOS',
    city: 'Озёрск-Северный',
    contactEmail: 'vityaz@sambo.local',
  },
  {
    id: SEED_IDS.organizer,
    type: 'ORGANIZER',
    parentId: SEED_IDS.federation,
    name: 'Оргкомитет турнира «Кубок Юности» (учебный)',
    shortName: 'Оргкомитет «Кубок Юности»',
    slug: 'kubok-yunosti',
    regionCode: 'RU-MOS',
    city: 'Северогорск',
    contactEmail: 'organizer@sambo.local',
  },
];

export interface SeedUser {
  id: string;
  identityId: string;
  personId: string;
  email: string;
  displayName: string;
  totp: boolean;
  person: { lastName: string; firstName: string; birthDate: string; gender: 'MALE' | 'FEMALE' };
  /** Роль на платформе (organizationId и competitionId пусты), в организации или в турнире. */
  grants: { id: string; role: string; organizationId: string | null; competitionId?: string }[];
}

const u = (n: number): string => `01920000-0000-7000-8001-${String(n).padStart(12, '0')}`;
const i = (n: number): string => `01920000-0000-7000-8002-${String(n).padStart(12, '0')}`;
const p = (n: number): string => `01920000-0000-7000-8003-${String(n).padStart(12, '0')}`;
const g = (n: number): string => `01920000-0000-7000-8004-${String(n).padStart(12, '0')}`;

export const SEED_USERS: SeedUser[] = [
  {
    id: u(1),
    identityId: i(1),
    personId: p(1),
    email: 'admin@sambo.local',
    displayName: 'Администратор платформы',
    totp: true,
    person: { lastName: 'Админов', firstName: 'Олег', birthDate: '1985-03-14', gender: 'MALE' },
    grants: [{ id: g(1), role: 'SUPER_ADMIN', organizationId: null }],
  },
  {
    id: u(2),
    identityId: i(2),
    personId: p(2),
    email: 'federation@sambo.local',
    displayName: 'Руководитель федерации',
    totp: false,
    person: { lastName: 'Федорова', firstName: 'Марина', birthDate: '1979-07-02', gender: 'FEMALE' },
    grants: [{ id: g(2), role: 'FEDERATION_ADMIN', organizationId: SEED_IDS.federation }],
  },
  {
    id: u(3),
    identityId: i(3),
    personId: p(3),
    email: 'organizer@sambo.local',
    displayName: 'Организатор турнира',
    totp: false,
    person: { lastName: 'Турнирин', firstName: 'Павел', birthDate: '1982-11-20', gender: 'MALE' },
    grants: [{ id: g(3), role: 'ORGANIZER', organizationId: SEED_IDS.organizer }],
  },
  {
    id: u(4),
    identityId: i(4),
    personId: p(4),
    email: 'manager1@sambo.local',
    displayName: 'Директор СШ «Самбо-Север»',
    totp: false,
    person: { lastName: 'Школьников', firstName: 'Игорь', birthDate: '1975-01-30', gender: 'MALE' },
    grants: [{ id: g(4), role: 'CLUB_MANAGER', organizationId: SEED_IDS.clubSambo }],
  },
  {
    id: u(5),
    identityId: i(5),
    personId: p(5),
    email: 'manager2@sambo.local',
    displayName: 'Руководитель клуба «Витязь-У»',
    totp: false,
    person: { lastName: 'Витязева', firstName: 'Анна', birthDate: '1988-05-09', gender: 'FEMALE' },
    grants: [{ id: g(5), role: 'CLUB_MANAGER', organizationId: SEED_IDS.clubVityaz }],
  },
  {
    id: u(6),
    identityId: i(6),
    personId: p(6),
    email: 'coach1@sambo.local',
    displayName: 'Тренер Самбо-Север',
    totp: false,
    person: { lastName: 'Тренеров', firstName: 'Сергей', birthDate: '1990-09-12', gender: 'MALE' },
    grants: [{ id: g(6), role: 'COACH', organizationId: SEED_IDS.clubSambo }],
  },
  {
    id: u(7),
    identityId: i(7),
    personId: p(7),
    email: 'coach2@sambo.local',
    displayName: 'Тренер Витязь-У',
    totp: false,
    person: { lastName: 'Наставникова', firstName: 'Елена', birthDate: '1992-02-25', gender: 'FEMALE' },
    grants: [{ id: g(7), role: 'COACH', organizationId: SEED_IDS.clubVityaz }],
  },
  {
    id: u(8),
    identityId: i(8),
    personId: p(8),
    email: 'referee1@sambo.local',
    displayName: 'Судья 1',
    totp: false,
    person: { lastName: 'Судейкин', firstName: 'Андрей', birthDate: '1980-04-18', gender: 'MALE' },
    grants: [],
  },
  {
    id: u(9),
    identityId: i(9),
    personId: p(9),
    email: 'referee2@sambo.local',
    displayName: 'Судья 2',
    totp: false,
    person: { lastName: 'Арбитрова', firstName: 'Ольга', birthDate: '1986-12-03', gender: 'FEMALE' },
    grants: [],
  },
  {
    id: u(10),
    identityId: i(10),
    personId: p(10),
    email: 'parent1@sambo.local',
    displayName: 'Родитель спортсмена',
    totp: false,
    person: { lastName: 'Орлова', firstName: 'Светлана', birthDate: '1986-08-17', gender: 'FEMALE' },
    grants: [],
  },
  {
    id: u(11),
    identityId: i(11),
    personId: p(11),
    email: 'secretary@sambo.local',
    displayName: 'Секретарь «Кубка Юности»',
    totp: false,
    person: { lastName: 'Протоколова', firstName: 'Вера', birthDate: '1991-01-22', gender: 'FEMALE' },
    grants: [{ id: g(11), role: 'SECRETARY', organizationId: null, competitionId: SEED_IDS.competition }],
  },
];
