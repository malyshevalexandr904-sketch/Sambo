// Seed Phase 5a (DATABASE.md, 11): учебный турнир «Кубок „Витязь“» на этапе жеребьёвки — сегодня. Категории:
// юноши до 42 кг (10 спортсменов двух клубов — выбывание с утешительными схватками, BYE, разведение), девушки до 40 кг
// (5 — круговая система), девушки свыше 40 кг (допуск ещё не решён — категория не готова к жеребьёвке).
// Жеребьёвку проводят на экране: seed создаёт только готовые к ней категории. Все данные вымышленные.
// Повторный запуск обновляет турнир и категории (кроме статуса — он результат демонстрации), заявки и участия
// не трогает.
import { fullName, todayIn } from '@sde/contracts';
import type { PrismaClient } from '../generated/client';
import { SEED_IDS } from './data';
import { P3, SEED_ATHLETES, type SeedAthlete } from './phase3-data';
import { asDate, DAY, entryData, type SeedCategory, TIMEZONE, userByEmail } from './phase4';

const id = (block: string, n: number): string => `01920000-0000-7000-${block}-${String(n).padStart(12, '0')}`;

export const P5 = {
  competition: SEED_IDS.competitionDraw,
  category: (n: number) => id('8028', n),
  application: (n: number) => id('8029', n),
  entry: (n: number) => id('802a', n),
  admission: (n: number) => id('802b', n),
  admissionCheck: (n: number) => id('802c', n),
  requirement: id('802d', 1),
} as const;

interface DrawSeedCategory extends SeedCategory {
  status: 'READY_FOR_DRAW' | 'WEIGH_IN';
  pick: (a: SeedAthlete) => boolean;
}

const CATEGORIES: DrawSeedCategory[] = [
  {
    n: 1,
    code: 'M-Y12_15-42',
    nameRu: 'Юноши 12–15 лет, до 42 кг',
    nameEn: 'Boys 12–15, up to 42 kg',
    gender: 'MALE',
    kind: 'UP_TO',
    lower: 38_000,
    upper: 42_000,
    status: 'READY_FOR_DRAW',
    pick: (a) => a.gender === 'MALE',
  },
  {
    n: 2,
    code: 'F-Y12_15-40',
    nameRu: 'Девушки 12–15 лет, до 40 кг',
    nameEn: 'Girls 12–15, up to 40 kg',
    gender: 'FEMALE',
    kind: 'UP_TO',
    lower: 36_000,
    upper: 40_000,
    status: 'READY_FOR_DRAW',
    pick: (a) => a.gender === 'FEMALE' && a.n % 4 !== 0,
  },
  {
    n: 3,
    code: 'F-Y12_15-40+',
    nameRu: 'Девушки 12–15 лет, свыше 40 кг',
    nameEn: 'Girls 12–15, over 40 kg',
    gender: 'FEMALE',
    kind: 'ABOVE',
    lower: 40_000,
    upper: null,
    status: 'WEIGH_IN',
    pick: (a) => a.gender === 'FEMALE' && a.n % 4 === 0,
  },
];

async function seedCompetition(db: PrismaClient, today: string): Promise<void> {
  const organizer = userByEmail('organizer@sambo.local');
  const data = {
    slug: `kubok-vityaz-${today}`,
    name: 'Кубок «Витязь» (учебный)',
    shortName: 'Кубок «Витязь»',
    descriptionMd: 'Учебный турнир на этапе жеребьёвки. **Все данные вымышленные.**',
    organizerOrganizationId: SEED_IDS.organizer,
    venueId: null,
    timezone: TIMEZONE,
    startDate: asDate(today),
    endDate: asDate(today),
    registrationStartsAt: new Date(Date.now() - 20 * DAY),
    registrationEndsAt: new Date(Date.now() - 2 * DAY),
    status: 'DRAWING' as const,
    level: 'CLUB' as const,
    disciplineCode: 'SPORT_SAMBO',
    ruleSetVersionId: P3.ruleSetVersion,
    weighInFailureOutcome: 'RECHECK' as const,
    publishedAt: new Date(Date.now() - 20 * DAY),
    deletedAt: null,
    updatedById: organizer.id,
  };
  await db.competition.upsert({
    where: { id: P5.competition },
    create: { id: P5.competition, ...data, createdById: organizer.id },
    update: data,
  });
  await db.competitionWriteLease.upsert({
    where: { competitionId: P5.competition },
    create: { competitionId: P5.competition, holderType: 'CLOUD', epoch: 1, status: 'ACTIVE' },
    update: {},
  });
}

async function seedCategories(db: PrismaClient): Promise<void> {
  for (const c of CATEGORIES) {
    const row = {
      competitionId: P5.competition,
      code: c.code,
      nameRu: c.nameRu,
      nameEn: c.nameEn,
      gender: c.gender,
      ageGroupId: null,
      agePolicy: 'BY_BIRTH_YEAR' as const,
      ageFrom: 12,
      ageTo: 15,
      weightKind: c.kind,
      weightLowerGrams: c.lower,
      weightUpperGrams: c.upper,
      mergedIntoId: null,
      sortOrder: c.n * 10,
    };
    const existing = await db.competitionCategory.findUnique({ where: { id: P5.category(c.n) } });
    if (existing) await db.competitionCategory.update({ where: { id: existing.id }, data: row });
    else await db.competitionCategory.create({ data: { id: P5.category(c.n), ...row, status: c.status } });
  }
  // Взвешивание обязательно только в последней категории: там допуск ещё не решён.
  const requirement = {
    competitionId: P5.competition,
    categoryId: P5.category(3),
    kind: 'WEIGH_IN' as const,
    mandatory: true,
  };
  await db.competitionRequirement.upsert({
    where: { id: P5.requirement },
    create: { id: P5.requirement, ...requirement },
    update: requirement,
  });
}

/** Одобренные заявки клубов с участиями и допуском; создаются один раз. */
async function seedApplications(db: PrismaClient): Promise<number> {
  if (await db.application.findUnique({ where: { id: P5.application(1) } })) return 0;
  const secretary = userByEmail('secretary@sambo.local');
  const decided = new Date(Date.now() - 3 * DAY);
  let entryN = 0;
  for (const [i, clubId] of [SEED_IDS.clubSambo, SEED_IDS.clubVityaz].entries()) {
    const author = userByEmail(i === 0 ? 'manager1@sambo.local' : 'manager2@sambo.local');
    const coachUser = userByEmail(i === 0 ? 'coach1@sambo.local' : 'coach2@sambo.local');
    const club = await db.organization.findUniqueOrThrow({
      where: { id: clubId },
      include: { region: true },
    });
    await db.application.create({
      data: {
        id: P5.application(i + 1),
        competitionId: P5.competition,
        organizationId: clubId,
        status: 'APPROVED',
        representationOrganizationId: clubId,
        representationRegionId: club.regionId,
        submittedAt: new Date(Date.now() - 5 * DAY),
        submittedByUserId: author.id,
        reviewedAt: decided,
        reviewedById: secretary.id,
        createdById: author.id,
      },
    });
    for (const a of SEED_ATHLETES.filter((x) => x.club === clubId)) {
      const category = CATEGORIES.find((c) => c.pick(a));
      if (!category) continue;
      entryN += 1;
      await db.entry.create({
        data: {
          id: P5.entry(entryN),
          applicationId: P5.application(i + 1),
          ...entryData(a, club, fullName(coachUser.person), category, {
            competitionId: P5.competition,
            categoryId: P5.category(category.n),
          }),
          status: 'APPROVED',
          decidedAt: decided,
          decidedById: secretary.id,
          createdById: author.id,
        },
      });
      await seedAdmission(db, entryN, category.status === 'READY_FOR_DRAW');
    }
  }
  return entryN;
}

/** Допуск, как его вычисляет модуль admission: без требований — ADMITTED; с взвешиванием — ждёт взвешивания. */
async function seedAdmission(db: PrismaClient, n: number, ready: boolean): Promise<void> {
  await db.admission.create({
    data: {
      id: P5.admission(n),
      competitionId: P5.competition,
      entryId: P5.entry(n),
      status: ready ? 'ADMITTED' : 'PENDING',
      decidedAt: ready ? new Date() : null,
      checks: ready
        ? undefined
        : {
            create: {
              id: P5.admissionCheck(n),
              competitionId: P5.competition,
              kind: 'WEIGHT',
              status: 'PENDING',
              reasonCode: 'weigh_in_expected',
            },
          },
    },
  });
}

/** Возвращает строки для итогового сообщения seed. */
export async function seedPhase5(db: PrismaClient): Promise<string[]> {
  const today = todayIn(TIMEZONE);
  await seedCompetition(db, today);
  await seedCategories(db);
  const entries = await seedApplications(db);
  return [
    `Phase 5a: competition «Кубок „Витязь“» (${today}, draw stage): boys up to 42 kg and girls up to 40 kg ready`,
    `  for the draw, girls over 40 kg awaiting weigh-in${entries ? ` (${entries} entries)` : ''}.`,
    '  organizer@sambo.local — draft and publish; referee1@sambo.local — CHIEF_REFEREE (new draw version);',
    '  secretary@sambo.local — SECRETARY (drafts).',
  ];
}
