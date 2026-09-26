// Фикстуры Phase 4a: турнир (напрямую в БД — для тестов других модулей), правила, категории, спортсмены клуба.
import { uuidv7 } from '@sde/db';
import type { TestApp } from './app';
import { createOrg } from './app';

const day = 24 * 60 * 60 * 1000;
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Турнир-заготовка в БД (черновик, право записи у облака). Для проверки API турниров — POST /competitions. */
export async function ensureCompetition(
  t: TestApp,
  id: string,
  opts: { organizerId?: string; status?: 'DRAFT' | 'REGISTRATION_OPEN'; ruleSetVersionId?: string } = {},
): Promise<string> {
  const existing = await t.admin.competition.findUnique({ where: { id } });
  if (existing) return id;
  const organizerId = opts.organizerId ?? (await createOrg(t, { type: 'ORGANIZER' }));
  const start = new Date(Date.now() + 30 * day);
  await t.admin.competition.create({
    data: {
      id,
      slug: `test-${id.slice(-12)}`,
      name: `Турнир ${id.slice(-4)}`,
      organizerOrganizationId: organizerId,
      timezone: 'Europe/Moscow',
      startDate: new Date(`${isoDate(start)}T00:00:00Z`),
      endDate: new Date(`${isoDate(start)}T00:00:00Z`),
      registrationStartsAt: new Date(Date.now() - day),
      registrationEndsAt: new Date(Date.now() + 20 * day),
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
      status: opts.status ?? 'DRAFT',
      ruleSetVersionId: opts.ruleSetVersionId ?? null,
    },
  });
  await t.admin.competitionWriteLease.create({ data: { competitionId: id } });
  return id;
}

/** Опубликованная версия правил платформы (параметры — как в DATABASE.md, 3.4). */
export async function publishedRuleSet(t: TestApp): Promise<string> {
  const ruleSetId = uuidv7();
  await t.admin.ruleSet.create({
    data: {
      id: ruleSetId,
      code: `RS_${ruleSetId.slice(-8).toUpperCase()}`,
      disciplineCode: 'SPORT_SAMBO',
      name: 'Правила',
    },
  });
  const versionId = uuidv7();
  await t.admin.ruleSetVersion.create({
    data: {
      id: versionId,
      ruleSetId,
      version: 1,
      schemaVersion: 1,
      parameters: RULESET_PARAMETERS,
      checksum: 'a'.repeat(64),
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  return versionId;
}

export const RULESET_PARAMETERS = {
  matchDuration: [{ ageFrom: 10, ageTo: 17, seconds: 180 }],
  minRestSeconds: 600,
  weighInToleranceGrams: 0,
  actions: [
    { code: 'THROW_4', points: 4 },
    { code: 'SUBMISSION', kind: 'TOTAL_VICTORY' },
  ],
  hold: { thresholds: [{ seconds: 10, points: 2 }], maxPerMatch: 1 },
  penalties: [{ code: 'WARNING_1', opponentPoints: 1 }],
  superiorityPoints: 8,
  tieBreakers: ['LAST_TECHNICAL_ACTION'],
  formatSelection: [{ minParticipants: 2, maxParticipants: null, format: 'ROUND_ROBIN' }],
};

/** Шаблон платформы: юноши 12–13 лет «до 35», «до 38», «свыше 38»; девушки — «до 34». */
export async function categoryTemplate(t: TestApp): Promise<{ templateId: string; ageGroupId: string }> {
  const ageGroupId = uuidv7();
  const code = `Y${ageGroupId.slice(-6).toUpperCase()}`;
  await t.admin.ageGroup.create({
    data: {
      id: ageGroupId,
      disciplineCode: 'SPORT_SAMBO',
      code,
      nameRu: '12–13 лет',
      nameEn: '12–13',
      policy: 'BY_BIRTH_YEAR',
      ageFrom: 12,
      ageTo: 13,
    },
  });
  const weights = [
    { gender: 'MALE' as const, kind: 'UP_TO' as const, limitGrams: 35000 },
    { gender: 'MALE' as const, kind: 'UP_TO' as const, limitGrams: 38000 },
    { gender: 'MALE' as const, kind: 'ABOVE' as const, limitGrams: 38000 },
    { gender: 'FEMALE' as const, kind: 'UP_TO' as const, limitGrams: 34000 },
  ];
  const templateId = uuidv7();
  await t.admin.categoryTemplate.create({
    data: { id: templateId, disciplineCode: 'SPORT_SAMBO', name: 'Юноши и девушки' },
  });
  for (const [i, w] of weights.entries()) {
    const wid = uuidv7();
    await t.admin.weightCategory.create({ data: { id: wid, ageGroupId, ...w, sortOrder: i } });
    await t.admin.categoryTemplateItem.create({
      data: { id: uuidv7(), templateId, ageGroupId, gender: w.gender, weightCategoryId: wid },
    });
  }
  return { templateId, ageGroupId };
}

/** Спортсмен клуба (с основным членством) и, по желанию, согласием на обработку ПДн. */
export async function clubAthlete(
  t: TestApp,
  opts: {
    clubId: string;
    birthDate?: string;
    gender?: 'MALE' | 'FEMALE';
    lastName?: string;
    consentTemplateId?: string;
    coachId?: string;
  },
): Promise<{ athleteId: string; personId: string }> {
  const personId = uuidv7();
  await t.admin.person.create({
    data: {
      id: personId,
      lastName: opts.lastName ?? `Борцов${personId.slice(-4)}`,
      firstName: 'Иван',
      birthDate: new Date(`${opts.birthDate ?? `${new Date().getUTCFullYear() - 12}-03-10`}T00:00:00Z`),
      gender: opts.gender ?? 'MALE',
    },
  });
  const athleteId = uuidv7();
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const publicId = Array.from(
    { length: 12 },
    (_, i) => alphabet[(personId.charCodeAt(i + 20) + i) % alphabet.length],
  ).join('');
  await t.admin.athleteProfile.create({ data: { id: athleteId, personId, publicId } });
  await t.admin.athleteMembership.create({
    data: {
      id: uuidv7(),
      athleteId,
      organizationId: opts.clubId,
      isPrimary: true,
      validFrom: new Date('2020-01-01T00:00:00Z'),
    },
  });
  if (opts.coachId)
    await t.admin.athleteCoach.create({
      data: {
        id: uuidv7(),
        athleteId,
        coachId: opts.coachId,
        isPrimary: true,
        validFrom: new Date('2020-01-01T00:00:00Z'),
      },
    });
  if (opts.consentTemplateId)
    await t.admin.consent.create({
      data: {
        id: uuidv7(),
        subjectPersonId: personId,
        givenByPersonId: personId,
        templateId: opts.consentTemplateId,
        method: 'ELECTRONIC',
        givenAt: new Date(),
      },
    });
  return { athleteId, personId };
}
