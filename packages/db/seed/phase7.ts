// Seed Phase 7a (DATABASE.md, 11; план Phase 7a, §8): учебный турнир «Кубок ковра» сегодня — после seed можно сразу
// судить на планшете и подтверждать результаты. Здесь — турнир, категории, заявки и допуск, 2 ковра и сессия на
// весь день; жеребьёвки, расписание, его публикацию, переход «Расписание готово» и бригады ковров выполняет реальный
// код API (apps/api/scripts/seed-schedule.ts), а не seed. Все данные вымышленные. Повторный запуск обновляет турнир,
// категории, ковры и сессию; заявки, участия и допуск создаются один раз.
import { fullName, todayIn } from '@sde/contracts';
import type { PrismaClient } from '../generated/client';
import { SEED_IDS } from './data';
import { P3, SEED_ATHLETES, type SeedAthlete } from './phase3-data';
import { asDate, DAY, entryData, type SeedCategory, TIMEZONE, userByEmail } from './phase4';

const id = (block: string, n: number): string => `01920000-0000-7000-${block}-${String(n).padStart(12, '0')}`;

export const P7 = {
  competition: SEED_IDS.competitionReferee,
  category: (n: number) => id('8036', n),
  application: (n: number) => id('8037', n),
  entry: (n: number) => id('8038', n),
  admission: (n: number) => id('8039', n),
  mat: (n: number) => id('8040', n),
  session: id('8041', 1),
} as const;

interface RefereeSeedCategory extends SeedCategory {
  pick: (a: SeedAthlete) => boolean;
}

const girls = SEED_ATHLETES.filter((a) => a.gender === 'FEMALE');

/** Юноши — выбывание с утешительными (10 участников), девушки — две круговые группы по 5. */
const CATEGORIES: RefereeSeedCategory[] = [
  {
    n: 1,
    code: 'M-REF-46',
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
    code: 'F-REF-44',
    nameRu: 'Девушки 12–15 лет, до 44 кг',
    nameEn: 'Girls 12–15, up to 44 kg',
    gender: 'FEMALE',
    kind: 'UP_TO',
    lower: null,
    upper: 44_000,
    pick: (a) => a.gender === 'FEMALE' && girls.indexOf(a) < 5,
  },
  {
    n: 3,
    code: 'F-REF-44P',
    nameRu: 'Девушки 12–15 лет, свыше 44 кг',
    nameEn: 'Girls 12–15, over 44 kg',
    gender: 'FEMALE',
    kind: 'ABOVE',
    lower: 44_000,
    upper: null,
    pick: (a) => a.gender === 'FEMALE' && girls.indexOf(a) >= 5,
  },
];

async function seedCompetition(db: PrismaClient, today: string): Promise<void> {
  const organizer = userByEmail('organizer@sambo.local');
  const data = {
    slug: `kubok-kovra-${today}`,
    name: 'Турнир «Кубок ковра» (учебный)',
    shortName: 'Кубок ковра',
    descriptionMd:
      'Учебный турнир для демонстрации судейства: расписание опубликовано, бригады на коврах — можно судить на планшете и подтверждать результаты. **Все данные вымышленные.**',
    organizerOrganizationId: SEED_IDS.organizer,
    venueId: null,
    timezone: TIMEZONE,
    startDate: asDate(today),
    endDate: asDate(today),
    registrationStartsAt: new Date(Date.now() - 20 * DAY),
    registrationEndsAt: new Date(Date.now() - 2 * DAY),
    level: 'CLUB' as const,
    disciplineCode: 'SPORT_SAMBO',
    ruleSetVersionId: P3.ruleSetVersion,
    weighInFailureOutcome: 'RECHECK' as const,
    publishedAt: new Date(Date.now() - 20 * DAY),
    deletedAt: null,
    updatedById: organizer.id,
  };
  // Статус задаётся только при создании: дальше турнир ведёт API (DRAWING → SCHEDULED → IN_PROGRESS).
  await db.competition.upsert({
    where: { id: P7.competition },
    create: { id: P7.competition, ...data, status: 'DRAWING', createdById: organizer.id },
    update: data,
  });
  await db.competitionWriteLease.upsert({
    where: { competitionId: P7.competition },
    create: { competitionId: P7.competition, holderType: 'CLOUD', epoch: 1, status: 'ACTIVE' },
    update: {},
  });
}

async function seedCategories(db: PrismaClient): Promise<void> {
  for (const c of CATEGORIES) {
    const row = {
      competitionId: P7.competition,
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
    const existing = await db.competitionCategory.findUnique({ where: { id: P7.category(c.n) } });
    if (existing) await db.competitionCategory.update({ where: { id: existing.id }, data: row });
    else
      await db.competitionCategory.create({
        data: { id: P7.category(c.n), ...row, status: 'READY_FOR_DRAW' },
      });
  }
}

/** 2 ковра и сессия на весь день запуска seed (08:00–23:00 по Москве): судить можно в любое время дня. */
async function seedMatsAndSession(db: PrismaClient, today: string): Promise<void> {
  for (let n = 1; n <= 2; n++) {
    const data = { competitionId: P7.competition, number: n, name: null, isActive: true };
    await db.mat.upsert({ where: { id: P7.mat(n) }, create: { id: P7.mat(n), ...data }, update: data });
  }
  const data = {
    competitionId: P7.competition,
    name: 'Основная',
    startsAt: new Date(`${today}T05:00:00.000Z`),
    endsAt: new Date(`${today}T20:00:00.000Z`),
  };
  await db.session.upsert({ where: { id: P7.session }, create: { id: P7.session, ...data }, update: data });
}

/** Одобренные заявки двух клубов с участиями и допуском; создаются один раз. */
async function seedApplications(db: PrismaClient): Promise<number> {
  if (await db.application.findUnique({ where: { id: P7.application(1) } })) return 0;
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
        id: P7.application(i + 1),
        competitionId: P7.competition,
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
          id: P7.entry(entryN),
          applicationId: P7.application(i + 1),
          ...entryData(a, club, fullName(coachUser.person), category, {
            competitionId: P7.competition,
            categoryId: P7.category(category.n),
          }),
          status: 'APPROVED',
          decidedAt: decided,
          decidedById: secretary.id,
          createdById: author.id,
        },
      });
      await db.admission.create({
        data: {
          id: P7.admission(entryN),
          competitionId: P7.competition,
          entryId: P7.entry(entryN),
          status: 'ADMITTED',
          decidedAt: decided,
        },
      });
    }
  }
  return entryN;
}

/** Возвращает строки для итогового сообщения seed. */
export async function seedPhase7(db: PrismaClient): Promise<string[]> {
  const today = todayIn(TIMEZONE);
  await seedCompetition(db, today);
  await seedCategories(db);
  await seedMatsAndSession(db, today);
  const entries = await seedApplications(db);
  return [
    `Phase 7a: competition «Кубок ковра» (${today}): 3 categories (${entries || 20} entries), 2 mats, one session.`,
    `  "pnpm --filter api run seed:schedule" publishes the draws and the schedule, assigns the mat crews:`,
    `  mat 1 — referee2 (tablet) and referee3 (mat chief), mat 2 — referee4 (tablet and mat chief);`,
    `  referee1@sambo.local — CHIEF_REFEREE (confirms any result); secretary@sambo.local calls the pairs.`,
  ];
}
