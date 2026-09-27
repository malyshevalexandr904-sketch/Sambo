// Seed Phase 4a (DATABASE.md, 11): учебный турнир «Кубок Юности» с открытой регистрацией — место проведения,
// закреплённая версия правил, категории из шаблона 12–14 лет, требования, правило «одна категория», право записи
// у облака и две заявки (поданная клубом «Самбо-Север» и черновик клуба «Витязь-У»). Все данные вымышленные.
// Сроки считаются от даты запуска seed: регистрация открыта, турнир через 30 дней. Повторный запуск обновляет
// турнир и категории, заявки и участия не трогает (их статусы — результат демонстрации).
import { categoryWeightLabel, fullName, publicName, zonedToInstant } from '@sde/contracts';
import type { Prisma, PrismaClient } from '../generated/client';
import { SEED_IDS, SEED_USERS } from './data';
import { P3, SEED_AGE_GROUPS, SEED_ATHLETES, type SeedAthlete } from './phase3-data';

const id = (block: string, n: number): string => `01920000-0000-7000-${block}-${String(n).padStart(12, '0')}`;

export const P4 = {
  competition: SEED_IDS.competition,
  category: (n: number) => id('8016', n),
  application: (n: number) => id('8017', n),
  entry: (n: number) => id('8018', n),
  requirement: (n: number) => id('8019', n),
  rule: (n: number) => id('801a', n),
  venue: id('801b', 1),
} as const;

const TIMEZONE = 'Europe/Moscow';
const DAY = 24 * 60 * 60 * 1000;
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const asDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

const userByEmail = (email: string): (typeof SEED_USERS)[number] => {
  const u = SEED_USERS.find((x) => x.email === email);
  if (!u) throw new Error(`Seed: user ${email} not found`);
  return u;
};

interface SeedCategory {
  n: number;
  code: string;
  nameRu: string;
  nameEn: string;
  gender: 'MALE' | 'FEMALE';
  kind: 'UP_TO' | 'ABOVE';
  lower: number | null;
  upper: number | null;
}

/** Категории шаблона 12–14 лет — как их строит генерация API: «M-Y12_14-38», «Юноши 12–14 лет, до 38 кг». */
function categoriesFromTemplate(): SeedCategory[] {
  const group = SEED_AGE_GROUPS.find((g) => g.code === 'Y12_14');
  if (!group) throw new Error('Seed: age group Y12_14 not found');
  const words = {
    MALE: { ru: 'Юноши', en: 'Boys', code: 'M' },
    FEMALE: { ru: 'Девушки', en: 'Girls', code: 'F' },
  } as const;
  const out: SeedCategory[] = [];
  for (const gender of ['MALE', 'FEMALE'] as const) {
    const limits = group.weights[gender].map((kg) => kg * 1000);
    const bounds = [
      ...limits.map((upper, i) => ({
        kind: 'UP_TO' as const,
        lower: i === 0 ? null : (limits[i - 1] ?? null),
        upper,
      })),
      { kind: 'ABOVE' as const, lower: limits[limits.length - 1] ?? 0, upper: null },
    ];
    for (const b of bounds) {
      const w = { kind: b.kind, lowerGrams: b.lower, upperGrams: b.upper };
      const kg = ((b.kind === 'ABOVE' ? b.lower : b.upper) ?? 0) / 1000;
      const g = words[gender];
      out.push({
        n: out.length + 1,
        code: `${g.code}-${group.code}-${kg}${b.kind === 'ABOVE' ? '+' : ''}`,
        nameRu: `${g.ru} ${group.ageFrom}–${group.ageTo} лет, ${categoryWeightLabel(w, 'ru')}`,
        nameEn: `${g.en} ${group.ageFrom}–${group.ageTo}, ${categoryWeightLabel(w, 'en')}`,
        gender,
        ...b,
      });
    }
  }
  return out;
}

async function seedVenue(db: PrismaClient, createdById: string): Promise<void> {
  const region = await db.region.findUniqueOrThrow({ where: { code: 'RU-MOS' } });
  const venue = {
    ownerOrganizationId: SEED_IDS.organizer,
    name: 'Дворец спорта «Северный» (учебный)',
    address: 'ул. Спортивная, 1',
    city: 'Северогорск',
    regionId: region.id,
    timezone: TIMEZONE,
    deletedAt: null,
  };
  await db.venue.upsert({
    where: { id: P4.venue },
    create: { id: P4.venue, ...venue, createdById },
    update: venue,
  });
}

/** Турнир с открытой регистрацией; сроки — от даты запуска seed. Возвращает дату начала. */
async function seedCompetitionRow(db: PrismaClient): Promise<string> {
  const organizer = userByEmail('organizer@sambo.local');
  await seedVenue(db, organizer.id);
  const now = new Date();
  const startDate = dateOnly(new Date(now.getTime() + 30 * DAY));
  const year = startDate.slice(0, 4);
  const data = {
    slug: `kubok-yunosti-${year}`,
    name: `Кубок Юности ${year} (учебный)`,
    shortName: 'Кубок Юности',
    descriptionMd:
      'Учебный турнир по самбо среди юношей и девушек 12–14 лет.\n\n- Жеребьёвка — после мандатной комиссии.\n- **Все данные вымышленные.**',
    organizerOrganizationId: SEED_IDS.organizer,
    venueId: P4.venue,
    timezone: TIMEZONE,
    startDate: asDate(startDate),
    endDate: asDate(dateOnly(new Date(now.getTime() + 31 * DAY))),
    registrationStartsAt: new Date(now.getTime() - DAY),
    registrationEndsAt: new Date(
      zonedToInstant(`${dateOnly(new Date(now.getTime() + 23 * DAY))}T23:59`, TIMEZONE),
    ),
    status: 'REGISTRATION_OPEN' as const,
    level: 'REGIONAL' as const,
    disciplineCode: 'SPORT_SAMBO',
    ruleSetVersionId: P3.ruleSetVersion,
    requirementsMd: 'Спортивная форма для самбо (куртка, шорты, борцовки), медицинский допуск и страховка.',
    contactInfo: { name: 'Турнирин Павел', email: 'organizer@sambo.local' } as Prisma.InputJsonValue,
    publishedAt: now,
    cancelledAt: null,
    cancelReason: null,
    deletedAt: null,
    updatedById: organizer.id,
  };
  await db.competition.upsert({
    where: { id: P4.competition },
    create: { id: P4.competition, ...data, createdById: organizer.id },
    update: data,
  });
  await db.competitionWriteLease.upsert({
    where: { competitionId: P4.competition },
    create: { competitionId: P4.competition, holderType: 'CLOUD', epoch: 1, status: 'ACTIVE' },
    update: {},
  });
  return startDate;
}

/** Категории из шаблона; годы рождения — от года начала турнира (как при генерации в API). */
async function seedCategories(db: PrismaClient, startDate: string): Promise<SeedCategory[]> {
  const group = await db.ageGroup.findUniqueOrThrow({ where: { id: P3.ageGroup(1) } });
  const year = Number(startDate.slice(0, 4));
  const categories = categoriesFromTemplate();
  for (const c of categories) {
    const row = {
      competitionId: P4.competition,
      code: c.code,
      nameRu: c.nameRu,
      nameEn: c.nameEn,
      gender: c.gender,
      ageGroupId: group.id,
      agePolicy: 'BY_BIRTH_YEAR' as const,
      ageFrom: group.ageFrom,
      ageTo: group.ageTo,
      birthYearFrom: year - group.ageTo,
      birthYearTo: year - group.ageFrom,
      weightKind: c.kind,
      weightLowerGrams: c.lower,
      weightUpperGrams: c.upper,
      status: 'REGISTRATION' as const,
      mergedIntoId: null,
      sortOrder: c.n * 10,
    };
    await db.competitionCategory.upsert({
      where: { id: P4.category(c.n) },
      create: { id: P4.category(c.n), ...row },
      update: row,
    });
  }
  return categories;
}

/** Требования к допуску и общее правило «одна категория на спортсмена». */
async function seedRequirements(db: PrismaClient): Promise<void> {
  const requirements = [
    { kind: 'MEDICAL_CLEARANCE' as const, noteMd: 'Справка врача или отметка в зачётной книжке.' },
    { kind: 'WEIGH_IN' as const, noteMd: null },
    { kind: 'CHECK_IN' as const, noteMd: null },
  ];
  for (const [i, r] of requirements.entries()) {
    const row = { competitionId: P4.competition, categoryId: null, mandatory: true, ...r };
    await db.competitionRequirement.upsert({
      where: { id: P4.requirement(i + 1) },
      create: { id: P4.requirement(i + 1), ...row },
      update: row,
    });
  }
  const rule = {
    competitionId: P4.competition,
    categoryId: null,
    kind: 'MAX_CATEGORIES_PER_ATHLETE' as const,
    params: { max: 1 },
  };
  await db.categoryRule.upsert({
    where: { id: P4.rule(1) },
    create: { id: P4.rule(1), ...rule },
    update: rule,
  });
}

/** Категория «до N кг», в которую проходит заявленный вес: для демонстрации берём вторую по весу. */
function pickCategory(categories: SeedCategory[], gender: 'MALE' | 'FEMALE'): SeedCategory {
  const list = categories.filter((c) => c.gender === gender && c.kind === 'UP_TO');
  const c = list[1] ?? list[0];
  if (!c) throw new Error('Seed: no category to enter');
  return c;
}

interface SeedApplication {
  n: number;
  club: string;
  coach: string;
  author: string;
  status: 'SUBMITTED' | 'DRAFT';
  athletes: number;
}

const APPLICATIONS: SeedApplication[] = [
  {
    n: 1,
    club: SEED_IDS.clubSambo,
    coach: 'coach1@sambo.local',
    author: 'manager1@sambo.local',
    status: 'SUBMITTED',
    athletes: 3,
  },
  {
    n: 2,
    club: SEED_IDS.clubVityaz,
    coach: 'coach2@sambo.local',
    author: 'coach2@sambo.local',
    status: 'DRAFT',
    athletes: 1,
  },
];

type ClubWithRegion = Prisma.OrganizationGetPayload<{ include: { region: true } }>;

/** Участие со снимком данных спортсмена на момент заявки (ADR-10). */
function entryData(
  a: SeedAthlete,
  club: ClubWithRegion,
  coachName: string,
  category: SeedCategory,
): Omit<Prisma.EntryUncheckedCreateInput, 'id' | 'applicationId' | 'createdById'> {
  const categoryId = P4.category(category.n);
  return {
    competitionId: P4.competition,
    athleteId: P3.athlete(a.n),
    categoryId,
    declaredCategoryId: categoryId,
    status: 'PENDING',
    snapLastName: a.lastName,
    snapFirstName: a.firstName,
    snapMiddleName: a.middleName,
    snapBirthDate: asDate(a.birthDate),
    snapGender: a.gender,
    snapClubId: club.id,
    snapClubName: club.name,
    snapCoachName: coachName,
    snapRegionId: club.regionId,
    snapRegionName: club.region?.nameRu ?? null,
    snapRankCode: a.rank?.code ?? null,
    representationOrganizationId: club.id,
    representationRegionId: club.regionId,
    publicName: publicName(a.lastName, a.firstName),
    declaredWeightGrams: (category.upper ?? 40_000) - 800,
  };
}

/** Заявки создаются один раз: их статусы и решения по участиям — результат демонстрации. */
async function seedApplications(
  db: PrismaClient,
  startDate: string,
  categories: SeedCategory[],
): Promise<void> {
  const year = Number(startDate.slice(0, 4));
  const fits = (a: SeedAthlete): boolean => {
    const born = Number(a.birthDate.slice(0, 4));
    return born >= year - 14 && born <= year - 12;
  };
  let entryN = 0;
  for (const p of APPLICATIONS) {
    const author = userByEmail(p.author);
    const coachUser = userByEmail(p.coach);
    const coach = await db.coachProfile.findUnique({ where: { personId: coachUser.personId } });
    const club = await db.organization.findUniqueOrThrow({
      where: { id: p.club },
      include: { region: true },
    });
    const applicationId = P4.application(p.n);
    const exists = await db.application.findUnique({ where: { id: applicationId } });
    const athletes = SEED_ATHLETES.filter((a) => a.club === p.club && fits(a)).slice(0, p.athletes);
    entryN += athletes.length;
    if (exists) continue;
    const submitted = p.status === 'SUBMITTED';
    await db.application.create({
      data: {
        id: applicationId,
        competitionId: P4.competition,
        organizationId: p.club,
        coachId: coach?.id ?? null,
        status: p.status,
        representationOrganizationId: p.club,
        representationRegionId: club.regionId,
        submittedAt: submitted ? new Date() : null,
        submittedByUserId: submitted ? author.id : null,
        createdById: author.id,
        entries: {
          create: athletes.map((a, i) => ({
            id: P4.entry(entryN - athletes.length + i + 1),
            ...entryData(a, club, fullName(coachUser.person), pickCategory(categories, a.gender)),
            createdById: author.id,
          })),
        },
      },
    });
  }
}

/** Возвращает строки для итогового сообщения seed. */
export async function seedPhase4(db: PrismaClient): Promise<string[]> {
  const startDate = await seedCompetitionRow(db);
  const categories = await seedCategories(db, startDate);
  await seedRequirements(db);
  await seedApplications(db, startDate, categories);
  return [
    `Phase 4a: competition «Кубок Юности» (${startDate}, registration open), ${categories.length} categories,`,
    '  applications: «Самбо-Север» submitted (3 athletes), «Витязь-У» draft (1 athlete).',
    '  organizer@sambo.local — organizer (inherited rights); secretary@sambo.local — SECRETARY of the competition.',
    `  Public page: /ru/tournaments/kubok-yunosti-${startDate.slice(0, 4)}`,
  ];
}
