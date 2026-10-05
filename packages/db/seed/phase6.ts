// Seed Phase 6 (DATABASE.md, 11; план Phase 6, §10): учебный турнир «Открытый ковёр» на этапе жеребьёвки —
// сегодня, с уже опубликованными сетками (4 категории, 40 участий, 20 вымышленных спортсменов: каждый заявлен
// в свою весовую категорию и в категорию «свыше» — обычная практика самбо). 3 ковра и одна сессия на весь день уже
// есть; расписание не построено — секретарь строит его на экране при демонстрации. Все данные вымышленные.
// Повторный запуск обновляет турнир, категории, ковры и сессию; заявки, участия, допуск и жеребьёвки создаются
// один раз (их результат — демонстрация). Публикация жеребьёвок выполняется отдельным шагом (apps/api/scripts/
// seed-schedule.ts): здесь сетки и схватки не создаются — их строит реальный код API, а не seed.
import { fullName, todayIn } from '@sde/contracts';
import type { PrismaClient } from '../generated/client';
import { SEED_IDS } from './data';
import { P3, SEED_ATHLETES, type SeedAthlete } from './phase3-data';
import { asDate, DAY, entryData, type SeedCategory, TIMEZONE, userByEmail } from './phase4';

const id = (block: string, n: number): string => `01920000-0000-7000-${block}-${String(n).padStart(12, '0')}`;

export const P6 = {
  competition: SEED_IDS.competitionSchedule,
  category: (n: number) => id('8030', n),
  application: (n: number) => id('8031', n),
  entry: (n: number) => id('8032', n),
  admission: (n: number) => id('8033', n),
  mat: (n: number) => id('8034', n),
  session: id('8035', 1),
} as const;

interface ScheduleSeedCategory extends SeedCategory {
  pick: (a: SeedAthlete) => boolean;
}

/** Юноши и девушки 12–15 лет: своя весовая категория и категория «свыше» — те же 20 спортсменов дважды
 *  (40 участий), обычная практика самбо. */
const CATEGORIES: ScheduleSeedCategory[] = [
  {
    n: 1,
    code: 'M-SCHED-46',
    nameRu: 'Юноши 12–15 лет, до 46 кг',
    nameEn: 'Boys 12–15, up to 46 kg',
    gender: 'MALE',
    kind: 'UP_TO',
    lower: null,
    upper: 46_000,
    pick: (a) => a.gender === 'MALE',
  },
  {
    n: 2,
    code: 'F-SCHED-44',
    nameRu: 'Девушки 12–15 лет, до 44 кг',
    nameEn: 'Girls 12–15, up to 44 kg',
    gender: 'FEMALE',
    kind: 'UP_TO',
    lower: null,
    upper: 44_000,
    pick: (a) => a.gender === 'FEMALE',
  },
  {
    n: 3,
    code: 'M-SCHED-46P',
    nameRu: 'Юноши 12–15 лет, свыше 46 кг',
    nameEn: 'Boys 12–15, over 46 kg',
    gender: 'MALE',
    kind: 'ABOVE',
    lower: 46_000,
    upper: null,
    pick: (a) => a.gender === 'MALE',
  },
  {
    n: 4,
    code: 'F-SCHED-44P',
    nameRu: 'Девушки 12–15 лет, свыше 44 кг',
    nameEn: 'Girls 12–15, over 44 kg',
    gender: 'FEMALE',
    kind: 'ABOVE',
    lower: 44_000,
    upper: null,
    pick: (a) => a.gender === 'FEMALE',
  },
];

async function seedCompetition(db: PrismaClient, today: string): Promise<void> {
  const organizer = userByEmail('organizer@sambo.local');
  const data = {
    slug: `otkrytyi-kovior-${today}`,
    name: 'Турнир «Открытый ковёр» (учебный)',
    shortName: 'Открытый ковёр',
    descriptionMd:
      'Учебный турнир для демонстрации расписания: сетки уже опубликованы, расписание строится на экране. **Все данные вымышленные.**',
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
    where: { id: P6.competition },
    create: { id: P6.competition, ...data, createdById: organizer.id },
    update: data,
  });
  await db.competitionWriteLease.upsert({
    where: { competitionId: P6.competition },
    create: { competitionId: P6.competition, holderType: 'CLOUD', epoch: 1, status: 'ACTIVE' },
    update: {},
  });
}

async function seedCategories(db: PrismaClient): Promise<void> {
  for (const c of CATEGORIES) {
    const row = {
      competitionId: P6.competition,
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
    const existing = await db.competitionCategory.findUnique({ where: { id: P6.category(c.n) } });
    if (existing) await db.competitionCategory.update({ where: { id: existing.id }, data: row });
    else await db.competitionCategory.create({ data: { id: P6.category(c.n), ...row, status: 'READY_FOR_DRAW' } });
  }
}

/** 3 ковра турнира и одна сессия на весь день запуска seed (план §1, §10): готовы для генерации расписания. */
async function seedMatsAndSession(db: PrismaClient, today: string): Promise<void> {
  for (let n = 1; n <= 3; n++) {
    const data = { competitionId: P6.competition, number: n, name: null, isActive: true };
    await db.mat.upsert({ where: { id: P6.mat(n) }, create: { id: P6.mat(n), ...data }, update: data });
  }
  const data = {
    competitionId: P6.competition,
    name: 'Основная',
    startsAt: new Date(`${today}T06:00:00.000Z`), // 09:00 Europe/Moscow
    endsAt: new Date(`${today}T16:00:00.000Z`), // 19:00 Europe/Moscow
  };
  await db.session.upsert({ where: { id: P6.session }, create: { id: P6.session, ...data }, update: data });
}

/** Одобренные заявки клубов с участиями и допуском: каждый спортсмен — в своей весовой и в абсолютной (40 участий,
 *  20 спортсменов); создаются один раз. */
async function seedApplications(db: PrismaClient): Promise<number> {
  if (await db.application.findUnique({ where: { id: P6.application(1) } })) return 0;
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
        id: P6.application(i + 1),
        competitionId: P6.competition,
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
      for (const category of CATEGORIES.filter((c) => c.pick(a))) {
        entryN += 1;
        await db.entry.create({
          data: {
            id: P6.entry(entryN),
            applicationId: P6.application(i + 1),
            ...entryData(a, club, fullName(coachUser.person), category, {
              competitionId: P6.competition,
              categoryId: P6.category(category.n),
            }),
            status: 'APPROVED',
            decidedAt: decided,
            decidedById: secretary.id,
            createdById: author.id,
          },
        });
        await db.admission.create({
          data: {
            id: P6.admission(entryN),
            competitionId: P6.competition,
            entryId: P6.entry(entryN),
            status: 'ADMITTED',
            decidedAt: decided,
          },
        });
      }
    }
  }
  return entryN;
}

/** Возвращает строки для итогового сообщения seed. */
export async function seedPhase6(db: PrismaClient): Promise<string[]> {
  const today = todayIn(TIMEZONE);
  await seedCompetition(db, today);
  await seedCategories(db);
  await seedMatsAndSession(db, today);
  const entries = await seedApplications(db);
  return [
    `Phase 6: competition «Открытый ковёр» (${today}, draw stage): 4 categories ready for the draw`,
    `  (20 athletes, ${entries} entries — weight class + over-weight), 3 mats and one session already set up.`,
    `  Run "pnpm --filter api run seed:schedule" once to publish the draws (schedule itself stays unbuilt`,
    `  for the demo). secretary@sambo.local — SECRETARY; referee1@sambo.local — CHIEF_REFEREE;`,
    `  referee2@sambo.local — REFEREE; organizer@sambo.local — inherits TOURNAMENT_MANAGER.`,
  ];
}
