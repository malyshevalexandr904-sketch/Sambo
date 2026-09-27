// Seed Phase 4b (DATABASE.md, 11): учебный турнир «Открытое первенство „Самбо-Север“» на мандатной комиссии —
// сегодня, категории на взвешивании, одобренная заявка клуба с пятью спортсменами, весы и окно взвешивания на весь
// день, прибытие, медицинские допуски, попытки взвешивания и допуск по ним. Все данные вымышленные.
// Требования положения: медицинский допуск, взвешивание, прибытие. Итоги допуска записаны так, как их вычисляет
// API (модуль admission); любое действие на экране пересчитывает их из фактов.
// Повторный запуск обновляет турнир, категории, весы и окно (даты — от дня запуска); факты не трогает.
import { fullName, todayIn, zonedToInstant } from '@sde/contracts';
import type { Prisma, PrismaClient } from '../generated/client';
import { SEED_IDS } from './data';
import { P3, SEED_ATHLETES, type SeedAthlete } from './phase3-data';
import {
  asDate,
  categoriesFromTemplate,
  DAY,
  dateOnly,
  entryData,
  pickCategory,
  type SeedCategory,
  TIMEZONE,
  userByEmail,
} from './phase4';

const id = (block: string, n: number): string => `01920000-0000-7000-${block}-${String(n).padStart(12, '0')}`;

export const P4B = {
  competition: SEED_IDS.competitionCheckIn,
  category: (n: number) => id('801c', n),
  application: id('801d', 1),
  entry: (n: number) => id('801e', n),
  requirement: (n: number) => id('801f', n),
  scale: (n: number) => id('8020', n),
  window: id('8021', 1),
  windowCategory: (n: number) => id('8022', n),
  checkIn: (n: number) => id('8023', n),
  attempt: (n: number) => id('8024', n),
  clearance: (n: number) => id('8025', n),
  admission: (n: number) => id('8026', n),
  admissionCheck: (n: number) => id('8027', n),
} as const;

type CheckKind = 'MEDICAL' | 'WEIGHT' | 'CHECK_IN';
type CheckStatus = 'PENDING' | 'PASSED' | 'FAILED';

/** Сценарий мандатной комиссии: что уже произошло с каждым спортсменом. */
interface Story {
  arrival: 'ARRIVED' | 'NOT_ARRIVED' | null;
  method?: 'QR' | 'SEARCH';
  clearance: boolean;
  /** Отклонение веса от верхней границы категории, граммы; null — не взвешен. */
  weighed: number | null;
}

const STORIES: Story[] = [
  { arrival: 'ARRIVED', method: 'QR', clearance: true, weighed: -500 },
  { arrival: 'ARRIVED', method: 'SEARCH', clearance: true, weighed: null },
  { arrival: 'ARRIVED', method: 'QR', clearance: false, weighed: 300 },
  { arrival: 'NOT_ARRIVED', clearance: false, weighed: null },
  { arrival: null, clearance: false, weighed: null },
];

async function seedCompetition(db: PrismaClient, today: string): Promise<void> {
  const organizer = userByEmail('organizer@sambo.local');
  const data = {
    slug: `pervenstvo-sambo-sever-${today}`,
    name: 'Открытое первенство «Самбо-Север» (учебное)',
    shortName: 'Первенство «Самбо-Север»',
    descriptionMd: 'Учебный турнир на этапе мандатной комиссии и взвешивания. **Все данные вымышленные.**',
    organizerOrganizationId: SEED_IDS.organizer,
    venueId: null,
    timezone: TIMEZONE,
    startDate: asDate(today),
    endDate: asDate(today),
    registrationStartsAt: new Date(Date.now() - 20 * DAY),
    registrationEndsAt: new Date(Date.now() - 2 * DAY),
    status: 'CHECK_IN' as const,
    level: 'CLUB' as const,
    disciplineCode: 'SPORT_SAMBO',
    ruleSetVersionId: P3.ruleSetVersion,
    weighInFailureOutcome: 'RECHECK' as const,
    publishedAt: new Date(Date.now() - 20 * DAY),
    deletedAt: null,
    updatedById: organizer.id,
  };
  await db.competition.upsert({
    where: { id: P4B.competition },
    create: { id: P4B.competition, ...data, createdById: organizer.id },
    update: data,
  });
  await db.competitionWriteLease.upsert({
    where: { competitionId: P4B.competition },
    create: { competitionId: P4B.competition, holderType: 'CLOUD', epoch: 1, status: 'ACTIVE' },
    update: {},
  });
  const requirements = ['MEDICAL_CLEARANCE', 'WEIGH_IN', 'CHECK_IN'] as const;
  for (const [i, kind] of requirements.entries()) {
    const row = { competitionId: P4B.competition, categoryId: null, kind, mandatory: true };
    await db.competitionRequirement.upsert({
      where: { id: P4B.requirement(i + 1) },
      create: { id: P4B.requirement(i + 1), ...row },
      update: row,
    });
  }
}

async function seedCategories(db: PrismaClient, today: string): Promise<SeedCategory[]> {
  const group = await db.ageGroup.findUniqueOrThrow({ where: { id: P3.ageGroup(1) } });
  const year = Number(today.slice(0, 4));
  const categories = categoriesFromTemplate();
  for (const c of categories) {
    const row = {
      competitionId: P4B.competition,
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
      status: 'WEIGH_IN' as const,
      mergedIntoId: null,
      sortOrder: c.n * 10,
    };
    await db.competitionCategory.upsert({
      where: { id: P4B.category(c.n) },
      create: { id: P4B.category(c.n), ...row },
      update: { ...row, status: undefined },
    });
  }
  return categories;
}

/** Весы (одни с истёкшей поверкой) и официальное окно на весь день турнира для всех категорий. */
async function seedWeighInSetup(db: PrismaClient, today: string, categories: SeedCategory[]): Promise<void> {
  const scales = [
    { n: 1, name: 'Весы № 1 (основные)', serialNumber: 'ВЭ-150-0421', verifiedUntil: Date.now() + 180 * DAY },
    { n: 2, name: 'Весы № 2 (резервные)', serialNumber: 'ВЭ-150-0107', verifiedUntil: Date.now() - 10 * DAY },
  ];
  for (const s of scales) {
    const row = {
      competitionId: P4B.competition,
      name: s.name,
      serialNumber: s.serialNumber,
      verifiedUntil: asDate(dateOnly(new Date(s.verifiedUntil))),
    };
    await db.scale.upsert({
      where: { id: P4B.scale(s.n) },
      create: { id: P4B.scale(s.n), ...row },
      update: row,
    });
  }
  const window = {
    competitionId: P4B.competition,
    name: 'Официальное взвешивание',
    kind: 'OFFICIAL' as const,
    startsAt: new Date(zonedToInstant(`${today}T00:00`, TIMEZONE)),
    endsAt: new Date(zonedToInstant(`${today}T23:59`, TIMEZONE)),
  };
  await db.weighInWindow.upsert({
    where: { id: P4B.window },
    create: { id: P4B.window, ...window },
    update: window,
  });
  await db.weighInWindowCategory.createMany({
    data: categories.map((c) => ({
      id: P4B.windowCategory(c.n),
      competitionId: P4B.competition,
      windowId: P4B.window,
      categoryId: P4B.category(c.n),
    })),
    skipDuplicates: true,
  });
}

/** Заявка клуба «Самбо-Север», одобренная; создаётся один раз. Возвращает участников по порядку. */
async function seedApplication(db: PrismaClient, today: string, categories: SeedCategory[]) {
  const year = Number(today.slice(0, 4));
  const athletes = SEED_ATHLETES.filter((a) => {
    const born = Number(a.birthDate.slice(0, 4));
    return a.club === SEED_IDS.clubSambo && born >= year - 14 && born <= year - 12;
  }).slice(0, STORIES.length);
  const exists = await db.application.findUnique({ where: { id: P4B.application } });
  if (exists) return { athletes, created: false };
  const author = userByEmail('manager1@sambo.local');
  const coachUser = userByEmail('coach1@sambo.local');
  const secretary = userByEmail('secretary@sambo.local');
  const coach = await db.coachProfile.findUnique({ where: { personId: coachUser.personId } });
  const club = await db.organization.findUniqueOrThrow({
    where: { id: SEED_IDS.clubSambo },
    include: { region: true },
  });
  const decided = new Date(Date.now() - 3 * DAY);
  await db.application.create({
    data: {
      id: P4B.application,
      competitionId: P4B.competition,
      organizationId: club.id,
      coachId: coach?.id ?? null,
      status: 'APPROVED',
      representationOrganizationId: club.id,
      representationRegionId: club.regionId,
      submittedAt: new Date(Date.now() - 5 * DAY),
      submittedByUserId: author.id,
      reviewedAt: decided,
      reviewedById: secretary.id,
      createdById: author.id,
      entries: {
        create: athletes.map((a, i) => {
          const category = pickCategory(categories, a.gender);
          return {
            id: P4B.entry(i + 1),
            ...entryData(a, club, fullName(coachUser.person), category, {
              competitionId: P4B.competition,
              categoryId: P4B.category(category.n),
            }),
            status: 'APPROVED' as const,
            decidedAt: decided,
            decidedById: secretary.id,
            createdById: author.id,
          };
        }),
      },
    },
  });
  return { athletes, created: true };
}

interface SeededFacts {
  checks: Record<
    CheckKind,
    { status: CheckStatus; reasonCode: string | null; reasonParams?: Prisma.InputJsonValue }
  >;
  weighIn: 'EXPECTED' | 'PASSED' | 'RECHECK_REQUIRED';
}

/** Прибытие и медицинский допуск по сценарию. */
async function seedArrivalAndClearance(
  db: PrismaClient,
  n: number,
  athleteId: string,
  story: Story,
  at: Date,
) {
  const secretary = userByEmail('secretary@sambo.local');
  const doctor = userByEmail('doctor@sambo.local');
  const arrived = story.arrival === 'ARRIVED';
  await db.checkIn.create({
    data: story.arrival
      ? {
          id: P4B.checkIn(n),
          competitionId: P4B.competition,
          athleteId,
          status: story.arrival,
          method: arrived ? (story.method ?? 'SEARCH') : 'MANUAL',
          arrivedAt: arrived ? at : null,
          operatorId: secretary.id,
          version: 2,
        }
      : { id: P4B.checkIn(n), competitionId: P4B.competition, athleteId },
  });
  if (story.clearance)
    await db.medicalClearance.create({
      data: {
        id: P4B.clearance(n),
        athleteId,
        competitionId: null,
        validUntil: asDate(dateOnly(new Date(Date.now() + 200 * DAY))),
        issuedBy: 'Врачебно-физкультурный диспансер Северогорска (учебный)',
        recordedById: doctor.id,
      },
    });
}

/** Официальная попытка по сценарию и итог взвешивания (допуск по весу 0 г, исход — повторное взвешивание). */
async function seedWeighIn(
  db: PrismaClient,
  n: number,
  story: Story,
  category: SeedCategory,
  at: Date,
): Promise<SeededFacts['weighIn']> {
  if (story.weighed === null) return 'EXPECTED';
  const result = story.weighed <= 0 ? ('PASSED' as const) : ('FAILED' as const);
  await db.weighInAttempt.create({
    data: {
      id: P4B.attempt(n),
      competitionId: P4B.competition,
      entryId: P4B.entry(n),
      categoryId: P4B.category(category.n),
      windowId: P4B.window,
      scaleId: P4B.scale(1),
      weightGrams: (category.upper ?? 40_000) + story.weighed,
      measuredAt: new Date(at.getTime() + 10 * 60_000),
      kind: 'OFFICIAL',
      result,
      limitLowerGrams: category.lower,
      limitUpperGrams: category.upper,
      toleranceGrams: 0,
      operatorId: userByEmail('secretary@sambo.local').id,
    },
  });
  const status = result === 'PASSED' ? 'PASSED' : 'RECHECK_REQUIRED';
  await db.weighInRecord.create({
    data: { entryId: P4B.entry(n), competitionId: P4B.competition, status, lastAttemptId: P4B.attempt(n) },
  });
  return status;
}

/** Итоги проверок по фактам — как их вычисляет модуль admission. */
function checksFor(story: Story, weighIn: SeededFacts['weighIn']): SeededFacts['checks'] {
  const check = (status: CheckStatus, reasonCode: string | null = null) => ({ status, reasonCode });
  return {
    MEDICAL: story.clearance ? check('PASSED') : check('PENDING', 'medical_missing'),
    WEIGHT:
      weighIn === 'PASSED'
        ? check('PASSED')
        : check(
            'PENDING',
            weighIn === 'RECHECK_REQUIRED' ? 'weigh_in_recheck_required' : 'weigh_in_expected',
          ),
    CHECK_IN:
      story.arrival === 'ARRIVED'
        ? check('PASSED')
        : story.arrival === 'NOT_ARRIVED'
          ? check('FAILED', 'not_arrived')
          : check('PENDING', 'check_in_expected'),
  };
}

/** Прибытие, медицинский допуск и попытка взвешивания одного спортсмена по сценарию. */
async function seedFacts(
  db: PrismaClient,
  n: number,
  a: SeedAthlete,
  story: Story,
  category: SeedCategory,
  today: string,
): Promise<SeededFacts> {
  const at = new Date(zonedToInstant(`${today}T08:${String(10 + n * 7).padStart(2, '0')}`, TIMEZONE));
  await seedArrivalAndClearance(db, n, P3.athlete(a.n), story, at);
  const weighIn = await seedWeighIn(db, n, story, category, at);
  return { weighIn, checks: checksFor(story, weighIn) };
}

/** Допуск по фактам — как его вычисляет модуль admission (ARCHITECTURE.md, 16.3). */
async function seedAdmission(db: PrismaClient, n: number, facts: SeededFacts): Promise<string> {
  const statuses = Object.values(facts.checks).map((c) => c.status);
  const status = statuses.includes('FAILED')
    ? 'NOT_ADMITTED'
    : statuses.includes('PENDING')
      ? 'PENDING'
      : 'ADMITTED';
  await db.admission.create({
    data: {
      id: P4B.admission(n),
      competitionId: P4B.competition,
      entryId: P4B.entry(n),
      status,
      decidedAt: status === 'PENDING' ? null : new Date(),
      checks: {
        create: (['MEDICAL', 'WEIGHT', 'CHECK_IN'] as const).map((kind, i) => ({
          id: P4B.admissionCheck(n * 10 + i),
          competitionId: P4B.competition,
          kind,
          status: facts.checks[kind].status,
          reasonCode: facts.checks[kind].reasonCode,
        })),
      },
    },
  });
  return status;
}

/** Возвращает строки для итогового сообщения seed. */
export async function seedPhase4b(db: PrismaClient): Promise<string[]> {
  const today = todayIn(TIMEZONE);
  await seedCompetition(db, today);
  const categories = await seedCategories(db, today);
  await seedWeighInSetup(db, today, categories);
  const { athletes, created } = await seedApplication(db, today, categories);
  const statuses: string[] = [];
  if (created)
    for (const [i, a] of athletes.entries()) {
      const story = STORIES[i] as Story;
      const facts = await seedFacts(db, i + 1, a, story, pickCategory(categories, a.gender), today);
      statuses.push(`${a.lastName}: ${await seedAdmission(db, i + 1, facts)}`);
    }
  return [
    `Phase 4b: competition «Открытое первенство „Самбо-Север“» (${today}, check-in), categories on weigh-in,`,
    `  approved application of «Самбо-Север» (${athletes.length} athletes)${statuses.length ? `: ${statuses.join(', ')}` : ''}.`,
    '  Scales (one with expired verification), official weigh-in window for today.',
    '  doctor@sambo.local — MEDICAL_STAFF; secretary@sambo.local — SECRETARY of this competition too.',
  ];
}
