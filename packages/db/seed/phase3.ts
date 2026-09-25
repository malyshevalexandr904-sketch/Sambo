// Seed Phase 3 (DATABASE.md, 11): профили тренеров и судей, 20 спортсменов 2011–2014 г. р. с разрядами,
// представители и согласия, тексты согласий, опубликованный набор правил, возрастные группы, веса и шаблон.
// Идемпотентен: записи с фиксированными id обновляются; опубликованные версии (неизменяемые) только создаются.
import { canonicalJson, RULESET_SCHEMA_VERSION, SAMPLE_RULESET_PARAMETERS } from '@sde/contracts';
import { sha256Hex } from '@sde/server-kit';
import type { Prisma, PrismaClient } from '../generated/client';
import { SEED_IDS, SEED_USERS } from './data';
import {
  P3,
  SEED_AGE_GROUPS,
  SEED_ATHLETES,
  SEED_CONSENT_OPERATOR,
  SEED_CONSENT_OPERATOR_EN,
  SEED_CONSENT_TEXTS,
  SEED_GUARDIANS,
  type SeedAthlete,
  seedPublicId,
} from './phase3-data';

const date = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
const now = new Date();
const userByEmail = (email: string): (typeof SEED_USERS)[number] => {
  const u = SEED_USERS.find((x) => x.email === email);
  if (!u) throw new Error(`Seed: user ${email} not found`);
  return u;
};

async function seedCoachesAndReferees(db: PrismaClient): Promise<Map<1 | 2, string>> {
  const admin = userByEmail('admin@sambo.local');
  const coaches = new Map<1 | 2, string>();
  const list = [
    { n: 1 as const, user: userByEmail('coach1@sambo.local'), org: SEED_IDS.clubSambo },
    { n: 2 as const, user: userByEmail('coach2@sambo.local'), org: SEED_IDS.clubVityaz },
  ];
  for (const c of list) {
    const existing = await db.coachProfile.findUnique({ where: { personId: c.user.personId } });
    const coachId = existing?.id ?? P3.coach(c.n);
    if (!existing)
      await db.coachProfile.create({
        data: { id: coachId, personId: c.user.personId, createdById: admin.id },
      });
    await db.coachMembership.upsert({
      where: { id: P3.coachMembership(c.n) },
      create: {
        id: P3.coachMembership(c.n),
        coachId,
        organizationId: c.org,
        validFrom: date('2020-09-01'),
        createdById: admin.id,
      },
      update: { validTo: null },
    });
    coaches.set(c.n, coachId);
  }
  const referees = [
    { n: 1, user: userByEmail('referee1@sambo.local'), code: 'CAT_1', at: '2022-05-10' },
    { n: 2, user: userByEmail('referee2@sambo.local'), code: 'NATIONAL', at: '2019-11-01' },
  ];
  for (const r of referees) {
    const data = { refereeCategoryCode: r.code, categoryAssignedAt: date(r.at), status: 'ACTIVE' as const };
    const existing = await db.refereeProfile.findUnique({ where: { personId: r.user.personId } });
    if (existing) await db.refereeProfile.update({ where: { id: existing.id }, data });
    else
      await db.refereeProfile.create({
        data: { id: P3.referee(r.n), personId: r.user.personId, createdById: admin.id, ...data },
      });
  }
  return coaches;
}

/** Основной клуб и тренер спортсмена seed — с 1 сентября 2023 г. */
async function seedAthleteLinks(
  db: PrismaClient,
  a: SeedAthlete,
  athleteId: string,
  coachId: string,
  createdById: string,
): Promise<void> {
  await db.athleteMembership.upsert({
    where: { id: P3.membership(a.n) },
    create: {
      id: P3.membership(a.n),
      athleteId,
      organizationId: a.club,
      isPrimary: true,
      validFrom: date('2023-09-01'),
      createdById,
    },
    update: { validTo: null },
  });
  await db.athleteCoach.upsert({
    where: { id: P3.coachLink(a.n) },
    create: {
      id: P3.coachLink(a.n),
      athleteId,
      coachId,
      isPrimary: true,
      validFrom: date('2023-09-01'),
      createdById,
    },
    update: { validTo: null },
  });
}

async function seedAthletes(db: PrismaClient, coaches: Map<1 | 2, string>): Promise<void> {
  const creators = { 1: userByEmail('coach1@sambo.local').id, 2: userByEmail('coach2@sambo.local').id };
  for (const a of SEED_ATHLETES) {
    const personData = {
      lastName: a.lastName,
      firstName: a.firstName,
      middleName: a.middleName,
      birthDate: date(a.birthDate),
      gender: a.gender,
      countryCode: 'RU',
    };
    const personId = P3.athletePerson(a.n);
    await db.person.upsert({
      where: { id: personId },
      create: { id: personId, ...personData },
      update: personData,
    });
    const athleteId = P3.athlete(a.n);
    await db.athleteProfile.upsert({
      where: { id: athleteId },
      create: { id: athleteId, personId, publicId: seedPublicId(a.n), createdById: creators[a.coach] },
      update: { status: 'ACTIVE' },
    });
    await seedAthleteLinks(db, a, athleteId, coaches.get(a.coach) as string, creators[a.coach]);
    if (a.rank) {
      const rank = {
        sportRankCode: a.rank.code,
        assignedAt: date(a.rank.assignedAt),
        orderRef: a.rank.orderRef,
      };
      await db.athleteRankRecord.upsert({
        where: { id: P3.rank(a.n) },
        create: { id: P3.rank(a.n), athleteId, createdById: creators[a.coach], ...rank },
        update: rank,
      });
    }
  }
}

async function seedConsentTemplates(db: PrismaClient): Promise<Map<string, string>> {
  const admin = userByEmail('admin@sambo.local');
  const ids = new Map<string, string>();
  let n = 0;
  for (const text of SEED_CONSENT_TEXTS) {
    for (const locale of ['ru', 'en'] as const) {
      n += 1;
      // Опубликованный текст неизменен (триггер в БД): существующая версия не трогается.
      const existing = await db.consentTemplate.findFirst({
        where: { kind: text.kind, locale, publishedAt: { not: null }, retiredAt: null },
        orderBy: { version: 'desc' },
      });
      if (existing) {
        ids.set(`${text.kind}:${locale}`, existing.id);
        continue;
      }
      const created = await db.consentTemplate.create({
        data: {
          id: P3.consentTemplate(n),
          kind: text.kind,
          version: 1,
          locale,
          operatorName: locale === 'ru' ? SEED_CONSENT_OPERATOR : SEED_CONSENT_OPERATOR_EN,
          bodyMarkdown: locale === 'ru' ? text.ru : text.en,
          publishedAt: now,
          createdById: admin.id,
        },
      });
      ids.set(`${text.kind}:${locale}`, created.id);
    }
  }
  return ids;
}

async function seedGuardians(db: PrismaClient, templates: Map<string, string>): Promise<void> {
  const coach1 = userByEmail('coach1@sambo.local');
  const parent = userByEmail('parent1@sambo.local');
  let consentN = 0;
  for (const g of SEED_GUARDIANS) {
    const personId = g.person ? P3.guardianPerson(g.n) : parent.personId;
    if (g.person) {
      const data = { ...g.person, birthDate: date(g.person.birthDate), countryCode: 'RU' };
      await db.person.upsert({ where: { id: personId }, create: { id: personId, ...data }, update: data });
    }
    const verified = {
      verifiedAt: now,
      verifiedById: coach1.id,
      verificationBasis: 'DOCUMENT_SHOWN' as const,
      endedAt: null,
      endedById: null,
      endReason: null,
    };
    await db.guardian.upsert({
      where: { id: P3.guardian(g.n) },
      create: {
        id: P3.guardian(g.n),
        athleteId: P3.athlete(g.athlete),
        guardianPersonId: personId,
        relation: g.relation,
        createdById: coach1.id,
        ...verified,
      },
      update: verified,
    });
    if (!g.consents) continue;
    for (const kind of ['PD_PROCESSING', 'PD_DISTRIBUTION', 'HEALTH_DATA'] as const) {
      consentN += 1;
      const templateId = templates.get(`${kind}:ru`) as string;
      const subjectPersonId = P3.athletePerson(g.athlete);
      const active = await db.consent.findFirst({
        where: { subjectPersonId, templateId, competitionId: null, revokedAt: null },
      });
      if (active) continue;
      const data: Prisma.ConsentUncheckedCreateInput = {
        id: P3.consent(consentN),
        subjectPersonId,
        givenByPersonId: personId,
        templateId,
        method: 'ELECTRONIC',
        givenAt: now,
      };
      await db.consent.upsert({ where: { id: data.id as string }, create: data, update: {} });
    }
  }
}

async function seedRuleSet(db: PrismaClient): Promise<void> {
  const admin = userByEmail('admin@sambo.local');
  const data = {
    code: 'SAMBO_YOUTH_DEMO',
    disciplineCode: 'SPORT_SAMBO',
    name: 'Самбо: юноши и девушки (учебный)',
  };
  await db.ruleSet.upsert({
    where: { id: P3.ruleSet },
    create: { id: P3.ruleSet, ...data, createdById: admin.id },
    update: data,
  });
  const existing = await db.ruleSetVersion.findUnique({ where: { id: P3.ruleSetVersion } });
  if (existing) return;
  const parameters = SAMPLE_RULESET_PARAMETERS as unknown as Prisma.InputJsonValue;
  await db.ruleSetVersion.create({
    data: {
      id: P3.ruleSetVersion,
      ruleSetId: P3.ruleSet,
      version: 1,
      schemaVersion: RULESET_SCHEMA_VERSION,
      parameters,
      checksum: sha256Hex(canonicalJson(SAMPLE_RULESET_PARAMETERS)),
      status: 'PUBLISHED',
      publishedAt: now,
      publishedById: admin.id,
      createdById: admin.id,
    },
  });
}

async function seedCategories(db: PrismaClient): Promise<void> {
  const admin = userByEmail('admin@sambo.local');
  let weightN = 0;
  const items: { ageGroupId: string; gender: 'MALE' | 'FEMALE'; weightCategoryId: string }[] = [];
  for (const g of SEED_AGE_GROUPS) {
    const ageGroupId = P3.ageGroup(g.n);
    const data = {
      disciplineCode: 'SPORT_SAMBO',
      code: g.code,
      nameRu: g.nameRu,
      nameEn: g.nameEn,
      policy: 'BY_BIRTH_YEAR' as const,
      ageFrom: g.ageFrom,
      ageTo: g.ageTo,
      deletedAt: null,
    };
    await db.ageGroup.upsert({
      where: { id: ageGroupId },
      create: { id: ageGroupId, ...data, createdById: admin.id },
      update: data,
    });
    for (const gender of ['MALE', 'FEMALE'] as const) {
      const limits = g.weights[gender];
      const rows = [
        ...limits.map((kg, i) => ({ kind: 'UP_TO' as const, grams: kg * 1000, sortOrder: i * 10 })),
        { kind: 'ABOVE' as const, grams: (limits[limits.length - 1] ?? 0) * 1000, sortOrder: 1000 },
      ];
      for (const r of rows) {
        weightN += 1;
        const id = P3.weight(weightN);
        const w = {
          ageGroupId,
          gender,
          kind: r.kind,
          limitGrams: r.grams,
          sortOrder: r.sortOrder,
          deletedAt: null,
        };
        await db.weightCategory.upsert({ where: { id }, create: { id, ...w }, update: w });
        if (g.code === 'Y12_14') items.push({ ageGroupId, gender, weightCategoryId: id });
      }
    }
  }
  const template = {
    disciplineCode: 'SPORT_SAMBO',
    name: 'Кубок Юности: 12–14 лет (учебный)',
    deletedAt: null,
  };
  await db.categoryTemplate.upsert({
    where: { id: P3.categoryTemplate },
    create: { id: P3.categoryTemplate, ...template, createdById: admin.id },
    update: template,
  });
  await db.categoryTemplateItem.deleteMany({ where: { templateId: P3.categoryTemplate } });
  await db.categoryTemplateItem.createMany({
    data: items.map((it) => ({ templateId: P3.categoryTemplate, ...it })),
  });
}

/** Возвращает строки для итогового сообщения seed. */
export async function seedPhase3(db: PrismaClient): Promise<string[]> {
  const coaches = await seedCoachesAndReferees(db);
  await seedAthletes(db, coaches);
  const templates = await seedConsentTemplates(db);
  await seedGuardians(db, templates);
  await seedRuleSet(db);
  await seedCategories(db);
  return [
    `Phase 3: ${SEED_ATHLETES.length} athletes (2011–2014), coach profiles for coach1/coach2, referees, consent texts,`,
    '  rule set SAMBO_YOUTH_DEMO v1 (published), age groups Y12_14/Y14_16 with weights, category template.',
    `  parent1@sambo.local — verified guardian of Орлов Дмитрий (consents not given yet).`,
    `  secretary@sambo.local — SECRETARY of the training competition ${SEED_IDS.competition}`,
    '  (upload a document with this competition ID for the secretary to review).',
  ];
}
