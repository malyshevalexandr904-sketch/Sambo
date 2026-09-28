// Фикстуры Phase 5a: турнир на этапе жеребьёвки, категория с одобренными и допущенными участиями разных клубов,
// персонал турнира. Данные создаются напрямую в БД: путь заявка → допуск проверяют тесты Phase 4.
import type { RoleCode } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { createOrg, createUser, login, type Session, type TestApp } from './app';
import { clubAthlete, ensureCompetition, RULESET_PARAMETERS } from './phase4';

/** Правила: круговая система до 5 участников, дальше — выбывание с утешительными схватками. */
export const DRAW_RULESET = {
  ...RULESET_PARAMETERS,
  matchDuration: [
    { ageFrom: 10, ageTo: 13, seconds: 180 },
    { ageFrom: 14, ageTo: 17, seconds: 240 },
  ],
  repechageMatchSeconds: 150,
  formatSelection: [
    { minParticipants: 2, maxParticipants: 5, format: 'ROUND_ROBIN' },
    { minParticipants: 6, maxParticipants: null, format: 'ELIMINATION_WITH_REPECHAGE' },
  ],
};

export async function drawRuleSet(t: TestApp): Promise<string> {
  const ruleSetId = uuidv7();
  await t.admin.ruleSet.create({
    data: {
      id: ruleSetId,
      code: `RS_${ruleSetId.slice(-8).toUpperCase()}`,
      disciplineCode: 'SPORT_SAMBO',
      name: 'Правила',
    },
  });
  const id = uuidv7();
  await t.admin.ruleSetVersion.create({
    data: {
      id,
      ruleSetId,
      version: 1,
      schemaVersion: 1,
      parameters: DRAW_RULESET,
      checksum: 'b'.repeat(64),
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  return id;
}

export interface DrawWorld {
  competitionId: string;
  clubs: string[];
  staff: Record<'manager' | 'secretary' | 'chief' | 'outsider', Session>;
}

async function staffSession(t: TestApp, competitionId: string, role: RoleCode | null): Promise<Session> {
  const user = await createUser(t);
  if (role) {
    const r = await t.admin.role.findUniqueOrThrow({ where: { code: role } });
    await t.admin.competitionMembership.create({
      data: { id: uuidv7(), competitionId, userId: user.id, roleId: r.id, status: 'ACTIVE' },
    });
  }
  return login(t, user.email);
}

/** Турнир в статусе DRAWING с закреплёнными правилами, клубы и персонал: руководитель, секретарь, главный судья. */
export async function drawWorld(
  t: TestApp,
  opts: { clubs?: number; status?: string } = {},
): Promise<DrawWorld> {
  const competitionId = uuidv7();
  await ensureCompetition(t, competitionId, { ruleSetVersionId: await drawRuleSet(t) });
  await t.admin.competition.update({
    where: { id: competitionId },
    data: { status: (opts.status ?? 'DRAWING') as 'DRAWING' },
  });
  const clubs: string[] = [];
  for (let i = 0; i < (opts.clubs ?? 3); i++) clubs.push(await createOrg(t, { type: 'CLUB' }));
  return {
    competitionId,
    clubs,
    staff: {
      manager: await staffSession(t, competitionId, 'TOURNAMENT_MANAGER'),
      secretary: await staffSession(t, competitionId, 'SECRETARY'),
      chief: await staffSession(t, competitionId, 'CHIEF_REFEREE'),
      outsider: await staffSession(t, competitionId, null),
    },
  };
}

export interface CategoryFixture {
  categoryId: string;
  entries: string[];
  notAdmitted: string;
}

/**
 * Категория «до 38 кг» в статусе READY_FOR_DRAW: `admitted` одобренных участий с допуском ADMITTED (клубы по кругу)
 * и одно одобренное с NOT_ADMITTED — в жеребьёвку не попадает.
 */
export async function drawCategory(
  t: TestApp,
  w: DrawWorld,
  admitted: number,
  opts: { status?: string; code?: string; formatOverride?: string } = {},
): Promise<CategoryFixture> {
  const categoryId = uuidv7();
  await t.admin.competitionCategory.create({
    data: {
      id: categoryId,
      competitionId: w.competitionId,
      code: opts.code ?? `M-${categoryId.slice(-6).toUpperCase()}`,
      nameRu: 'Юноши 12–13 лет, до 38 кг',
      nameEn: 'Boys 12–13, up to 38 kg',
      gender: 'MALE',
      agePolicy: 'BY_BIRTH_YEAR',
      ageFrom: 12,
      ageTo: 13,
      weightKind: 'UP_TO',
      weightUpperGrams: 38000,
      status: (opts.status ?? 'READY_FOR_DRAW') as 'READY_FOR_DRAW',
      formatOverride: (opts.formatOverride ?? null) as 'ROUND_ROBIN' | null,
    },
  });
  const applications = new Map<string, string>();
  for (const clubId of w.clubs) {
    const id = uuidv7();
    await t.admin.application.create({
      data: {
        id,
        competitionId: w.competitionId,
        organizationId: clubId,
        status: 'APPROVED',
        submittedAt: new Date(),
      },
    });
    applications.set(clubId, id);
  }
  const entries: string[] = [];
  let notAdmitted = '';
  for (let i = 0; i <= admitted; i++) {
    const clubId = w.clubs[i % w.clubs.length] as string;
    const { athleteId } = await clubAthlete(t, { clubId, lastName: `Борцов${String(i).padStart(2, '0')}` });
    const entryId = uuidv7();
    await t.admin.entry.create({
      data: {
        id: entryId,
        competitionId: w.competitionId,
        applicationId: applications.get(clubId) as string,
        athleteId,
        categoryId,
        declaredCategoryId: categoryId,
        status: 'APPROVED',
        snapLastName: `Борцов${String(i).padStart(2, '0')}`,
        snapFirstName: 'Иван',
        snapBirthDate: new Date(`${new Date().getUTCFullYear() - 12}-03-10T00:00:00Z`),
        snapGender: 'MALE',
        snapClubId: clubId,
        snapClubName: `Клуб ${clubId.slice(-4)}`,
        publicName: `Борцов${String(i).padStart(2, '0')} И.`,
      },
    });
    const last = i === admitted;
    await t.admin.admission.create({
      data: {
        id: uuidv7(),
        competitionId: w.competitionId,
        entryId,
        status: last ? 'NOT_ADMITTED' : 'ADMITTED',
        decidedAt: new Date(),
      },
    });
    if (last) notAdmitted = entryId;
    else entries.push(entryId);
  }
  return { categoryId, entries, notAdmitted };
}

export const SEED_A = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
export const SEED_B = 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5';
