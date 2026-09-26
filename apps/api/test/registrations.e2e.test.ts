// Заявки и участники (Phase 4a): полный цикл заявки, инварианты раздела 53, окно регистрации, конкурентное
// одобрение, перевод, объединение категорий с участиями, снятие, выгрузка CSV, изоляция клубов.
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createTestApp,
  createUser,
  login,
  resetData,
  type Session,
  type TestApp,
} from './helpers/app';
import { competitionStaff, givePerson, publishConsentTemplates, send } from './helpers/phase3';
import { categoryTemplate, clubAthlete, isoDate, publishedRuleSet } from './helpers/phase4';

let t: TestApp;
let consents: Record<string, string>;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  consents = await publishConsentTemplates(t);
});
afterAll(async () => {
  await t.close();
});

const day = 24 * 60 * 60 * 1000;

interface Category {
  id: string;
  code: string;
  version: number;
  status: string;
}

interface World {
  competitionId: string;
  version: number;
  organizer: Session;
  secretary: Session;
  secretary2: Session;
  coachA: Session;
  coachB: Session;
  clubA: string;
  clubB: string;
  cat: (suffix: string) => Category;
  athletes: { boy1: string; boy2: string; girl: string; noConsent: string; boyB: string };
}

async function coachOf(clubId: string): Promise<Session> {
  const user = await createUser(t, { orgs: [{ organizationId: clubId, role: 'COACH' }] });
  const personId = await givePerson(t, user.id, {
    lastName: 'Тренеров',
    firstName: 'Семён',
    birthDate: '1985-02-02',
  });
  const coachId = uuidv7();
  await t.admin.coachProfile.create({ data: { id: coachId, personId } });
  await t.admin.coachMembership.create({
    data: { id: uuidv7(), coachId, organizationId: clubId, validFrom: new Date('2020-01-01T00:00:00Z') },
  });
  return login(t, user.email);
}

async function world(opts: { maxCategories?: number } = {}): Promise<World> {
  const organizerOrgId = await createOrg(t, { type: 'ORGANIZER' });
  const organizerUser = await createUser(t, {
    orgs: [{ organizationId: organizerOrgId, role: 'ORGANIZER' }],
  });
  const organizer = await login(t, organizerUser.email);
  const ruleSetVersionId = await publishedRuleSet(t);
  const { templateId } = await categoryTemplate(t);
  const start = new Date(Date.now() + 30 * day);
  const created = await send(organizer, 'post', '/api/v1/competitions', {
    name: `Первенство ${uuidv7().slice(-6)}`,
    organizerOrganizationId: organizerOrgId,
    level: 'CLUB',
    disciplineCode: 'SPORT_SAMBO',
    timezone: 'Europe/Moscow',
    startDate: isoDate(start),
    endDate: isoDate(start),
    registrationStartsAt: new Date(Date.now() - day).toISOString(),
    registrationEndsAt: new Date(Date.now() + 20 * day).toISOString(),
    ruleSetVersionId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const competitionId = created.body.data.id as string;
  const generated = await send(
    organizer,
    'post',
    `/api/v1/competitions/${competitionId}/categories/generate`,
    { templateId },
  );
  if (opts.maxCategories)
    await send(organizer, 'put', `/api/v1/competitions/${competitionId}/category-rules`, {
      rules: [{ kind: 'MAX_CATEGORIES_PER_ATHLETE', params: { max: opts.maxCategories } }],
    }).expect(200);
  const current = await organizer.agent.get(`/api/v1/competitions/${competitionId}`).expect(200);
  const published = await send(
    organizer,
    'post',
    `/api/v1/competitions/${competitionId}/transitions`,
    { to: 'REGISTRATION_OPEN' },
    current.body.data.version,
  );
  expect(published.status, JSON.stringify(published.body)).toBe(200);

  const secretaryUser = await createUser(t);
  await competitionStaff(t, secretaryUser.id, competitionId, 'SECRETARY');
  const secretary2User = await createUser(t);
  await competitionStaff(t, secretary2User.id, competitionId, 'SECRETARY');
  const clubA = await createOrg(t);
  const clubB = await createOrg(t);
  const year = start.getUTCFullYear() - 12;
  const pd = consents.PD_PROCESSING as string;
  const athletes = {
    boy1: (
      await clubAthlete(t, {
        clubId: clubA,
        birthDate: `${year}-04-01`,
        lastName: 'Алексеев',
        consentTemplateId: pd,
      })
    ).athleteId,
    boy2: (
      await clubAthlete(t, {
        clubId: clubA,
        birthDate: `${year}-06-01`,
        lastName: 'Борисов',
        consentTemplateId: pd,
      })
    ).athleteId,
    girl: (
      await clubAthlete(t, {
        clubId: clubA,
        birthDate: `${year}-02-01`,
        lastName: 'Васильева',
        gender: 'FEMALE',
        consentTemplateId: pd,
      })
    ).athleteId,
    noConsent: (await clubAthlete(t, { clubId: clubA, birthDate: `${year}-01-01`, lastName: 'Григорьев' }))
      .athleteId,
    boyB: (
      await clubAthlete(t, {
        clubId: clubB,
        birthDate: `${year}-05-05`,
        lastName: 'Дмитриев',
        consentTemplateId: pd,
      })
    ).athleteId,
  };
  const categories = generated.body.data as Category[];
  return {
    competitionId,
    version: published.body.data.version,
    organizer,
    secretary: await login(t, secretaryUser.email),
    secretary2: await login(t, secretary2User.email),
    coachA: await coachOf(clubA),
    coachB: await coachOf(clubB),
    clubA,
    clubB,
    cat: (suffix) => categories.find((c) => c.code.endsWith(suffix)) as Category,
    athletes,
  };
}

async function application(w: World, s: Session, organizationId: string) {
  const res = await send(s, 'post', `/api/v1/competitions/${w.competitionId}/applications`, {
    organizationId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; version: number; status: string };
}

const addEntry = (
  w: World,
  s: Session,
  appId: string,
  athleteId: string,
  suffix: string,
  declaredWeightGrams?: number,
) =>
  send(s, 'post', `/api/v1/applications/${appId}/entries`, {
    athleteId,
    categoryId: w.cat(suffix).id,
    declaredWeightGrams,
  });

const appVersion = async (s: Session, id: string): Promise<number> =>
  (await s.agent.get(`/api/v1/applications/${id}`).expect(200)).body.data.version;

describe('application cycle', () => {
  it('coach applies, the secretary decides per athlete, returns for correction, then approves; CSV export', async () => {
    const w = await world({ maxCategories: 1 });

    const eligible = await w.coachA.agent
      .get(`/api/v1/competitions/${w.competitionId}/eligible-categories`)
      .query({ athleteId: w.athletes.boy1, declaredWeightGrams: 36000 })
      .expect(200);
    expect(
      eligible.body.data.eligible.map((c: { code: string; weightMatch: boolean }) => [
        c.code.slice(-3),
        c.weightMatch,
      ]),
    ).toEqual([
      ['-35', false],
      ['-38', true],
      ['38+', false],
    ]);
    expect(eligible.body.data.ineligible).toEqual([
      expect.objectContaining({
        reasons: ['GENDER_MISMATCH'],
        category: expect.objectContaining({ gender: 'FEMALE' }),
      }),
    ]);
    await w.coachB.agent
      .get(`/api/v1/competitions/${w.competitionId}/eligible-categories`)
      .query({ athleteId: w.athletes.boy1 })
      .expect(404);

    const app = await application(w, w.coachA, w.clubA);
    expect(app.status).toBe('DRAFT');
    const empty = await send(
      w.coachA,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'SUBMITTED' },
      app.version,
    );
    expect(empty.body.error.code).toBe('APPLICATION_EMPTY');

    const wrongGender = await addEntry(w, w.coachA, app.id, w.athletes.girl, '-38');
    expect(wrongGender.body.error).toMatchObject({
      code: 'CATEGORY_INCOMPATIBLE',
      details: { reasons: ['GENDER_MISMATCH'] },
    });
    const noConsent = await addEntry(w, w.coachA, app.id, w.athletes.noConsent, '-38');
    expect(noConsent.body.error).toMatchObject({
      code: 'CONSENT_MISSING',
      details: { kinds: ['PD_PROCESSING'] },
    });
    const entry1 = await addEntry(w, w.coachA, app.id, w.athletes.boy1, '-38', 36000);
    expect(entry1.status, JSON.stringify(entry1.body)).toBe(201);
    expect(entry1.body.data).toMatchObject({
      status: 'PENDING',
      publicName: 'Алексеев И.',
      declaredWeightGrams: 36000,
      snapshot: { lastName: 'Алексеев', club: { id: w.clubA } },
      representation: { organization: { id: w.clubA } },
    });
    expect(entry1.body.data.category.id).toBe(entry1.body.data.declaredCategory.id);
    const twice = await addEntry(w, w.coachA, app.id, w.athletes.boy1, '-38');
    expect(twice.body.error.code).toBe('ATHLETE_ALREADY_ENTERED');
    const limit = await addEntry(w, w.coachA, app.id, w.athletes.boy1, '38+');
    expect(limit.body.error.code).toBe('MAX_CATEGORIES_EXCEEDED');
    expect((await addEntry(w, w.coachA, app.id, w.athletes.boy2, '-35')).status).toBe(201);
    expect((await addEntry(w, w.coachA, app.id, w.athletes.girl, '-34')).status).toBe(201);

    // Изоляция клубов: чужая заявка и чужие спортсмены не видны.
    await w.coachB.agent.get(`/api/v1/applications/${app.id}`).expect(404);
    expect((await addEntry(w, w.coachB, app.id, w.athletes.boyB, '-38')).status).toBe(404);
    const appB = await application(w, w.coachB, w.clubB);
    expect((await addEntry(w, w.coachB, appB.id, w.athletes.boy2, '-38')).status).toBe(404);

    const submitted = await send(
      w.coachA,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'SUBMITTED' },
      await appVersion(w.coachA, app.id),
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.data).toMatchObject({ status: 'SUBMITTED', counts: { entries: 3, pending: 3 } });
    expect(
      await t.admin.outboxEvent.count({
        where: { type: 'registration.application_submitted', aggregateId: app.id },
      }),
    ).toBe(1);
    const late = await addEntry(w, w.coachA, app.id, w.athletes.noConsent, '38+');
    expect(late.body.error.details.failed).toEqual(['application_not_editable']);

    // Очередь секретаря: заявки турнира; тренер другого клуба видит только свою.
    const queue = await w.secretary.agent
      .get(`/api/v1/competitions/${w.competitionId}/applications`)
      .query({ status: 'SUBMITTED' })
      .expect(200);
    expect(queue.body.data.map((a: { id: string }) => a.id)).toEqual([app.id]);
    const theirs = await w.coachB.agent
      .get(`/api/v1/competitions/${w.competitionId}/applications`)
      .expect(200);
    expect(theirs.body.data.map((a: { id: string }) => a.id)).toEqual([appB.id]);

    const full = await w.secretary.agent.get(`/api/v1/applications/${app.id}`).expect(200);
    const entry = (name: string) =>
      full.body.data.entries.find((e: { snapshot: { lastName: string } }) => e.snapshot.lastName === name);
    const approved = await send(
      w.secretary,
      'post',
      `/api/v1/entries/${entry('Алексеев').id}/decision`,
      { decision: 'APPROVED' },
      entry('Алексеев').version,
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await w.secretary.agent.get(`/api/v1/applications/${app.id}`)).body.data.status).toBe(
      'UNDER_REVIEW',
    );
    const noReason = await send(
      w.secretary,
      'post',
      `/api/v1/entries/${entry('Борисов').id}/decision`,
      { decision: 'REJECTED' },
      entry('Борисов').version,
    );
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const rejected = await send(
      w.secretary,
      'post',
      `/api/v1/entries/${entry('Борисов').id}/decision`,
      { decision: 'REJECTED', reason: 'Нет медицинской справки' },
      entry('Борисов').version,
    );
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Нет медицинской справки',
    });
    const coachDecides = await send(
      w.coachA,
      'post',
      `/api/v1/entries/${entry('Васильева').id}/decision`,
      { decision: 'APPROVED' },
      entry('Васильева').version,
    );
    expect(coachDecides.status).toBe(403);

    const early = await send(
      w.secretary,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'APPROVED' },
      await appVersion(w.secretary, app.id),
    );
    expect(early.body.error.details.failed).toEqual(['entries_pending']);
    const returnNoComment = await send(
      w.secretary,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'WAITING_DOCUMENTS' },
      await appVersion(w.secretary, app.id),
    );
    expect(returnNoComment.body.error.code).toBe('REASON_REQUIRED');
    const returned = await send(
      w.secretary,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'WAITING_DOCUMENTS', comment: 'Загрузите справку Борисова' },
      await appVersion(w.secretary, app.id),
    );
    expect(returned.body.data).toMatchObject({
      status: 'WAITING_DOCUMENTS',
      reviewComment: 'Загрузите справку Борисова',
    });
    expect(
      await t.admin.outboxEvent.count({
        where: { type: 'registration.application_returned', aggregateId: app.id },
      }),
    ).toBe(1);

    const resubmitted = await send(
      w.coachA,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'SUBMITTED' },
      returned.body.data.version,
    );
    expect(resubmitted.status).toBe(200);
    const again = await w.secretary.agent.get(`/api/v1/applications/${app.id}`).expect(200);
    const statuses = Object.fromEntries(
      again.body.data.entries.map((e: { snapshot: { lastName: string }; status: string }) => [
        e.snapshot.lastName,
        e.status,
      ]),
    );
    expect(statuses).toEqual({ Алексеев: 'APPROVED', Борисов: 'PENDING', Васильева: 'PENDING' });
    for (const e of again.body.data.entries.filter((x: { status: string }) => x.status === 'PENDING'))
      await send(
        w.secretary,
        'post',
        `/api/v1/entries/${e.id}/decision`,
        { decision: 'APPROVED' },
        e.version,
      ).expect(200);
    const done = await send(
      w.secretary,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'APPROVED' },
      await appVersion(w.secretary, app.id),
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.counts).toMatchObject({ approved: 3, pending: 0 });

    const counters = await w.organizer.agent.get(`/api/v1/competitions/${w.competitionId}`).expect(200);
    expect(counters.body.data.counters).toMatchObject({
      applications: 1,
      entriesApproved: 3,
      entriesPending: 0,
    });
    const entriesList = await w.secretary.agent
      .get(`/api/v1/competitions/${w.competitionId}/entries`)
      .query({ status: 'APPROVED' })
      .expect(200);
    expect(entriesList.body.data.map((e: { snapshot: { lastName: string } }) => e.snapshot.lastName)).toEqual(
      ['Алексеев', 'Борисов', 'Васильева'],
    );
    const foreign = await w.coachB.agent.get(`/api/v1/competitions/${w.competitionId}/entries`).expect(200);
    expect(foreign.body.data).toEqual([]);

    const csv = await w.secretary.agent
      .get(`/api/v1/competitions/${w.competitionId}/entries/export.csv`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="participants-.+-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = csv.text.split('\r\n');
    expect(lines[0]?.startsWith('﻿№;Фамилия;Имя')).toBe(true);
    expect(lines.filter(Boolean)).toHaveLength(4);
    expect(lines[1]).toContain(';Борисов;');
    expect(lines[1]).toContain(';Одобрено;Одобрена');
    await w.coachA.agent.get(`/api/v1/competitions/${w.competitionId}/entries/export.csv`).expect(403);
    expect(
      await t.admin.auditLog.count({ where: { competitionId: w.competitionId, action: 'entry.exported' } }),
    ).toBe(1);

    // Журнал синхронизации: участия — операционные данные турнира.
    expect(
      await t.admin.syncLog.count({ where: { competitionId: w.competitionId, tableName: 'entry' } }),
    ).toBeGreaterThan(5);
  });

  it('refuses applications outside the registration window', async () => {
    const w = await world();
    await t.admin.competition.update({
      where: { id: w.competitionId },
      data: {
        registrationStartsAt: new Date(Date.now() + day),
        registrationEndsAt: new Date(Date.now() + 2 * day),
      },
    });
    const early = await send(w.coachA, 'post', `/api/v1/competitions/${w.competitionId}/applications`, {
      organizationId: w.clubA,
    });
    expect(early.body.error.code).toBe('REGISTRATION_NOT_OPEN');
    await t.admin.competition.update({
      where: { id: w.competitionId },
      data: {
        registrationStartsAt: new Date(Date.now() - 2 * day),
        registrationEndsAt: new Date(Date.now() + day),
      },
    });
    const app = await application(w, w.coachA, w.clubA);
    expect((await addEntry(w, w.coachA, app.id, w.athletes.boy1, '-38')).status).toBe(201);
    await t.admin.competition.update({
      where: { id: w.competitionId },
      data: {
        registrationEndsAt: new Date(Date.now() - 60_000),
        registrationStartsAt: new Date(Date.now() - 2 * day),
      },
    });
    const closed = await addEntry(w, w.coachA, app.id, w.athletes.boy2, '-35');
    expect(closed.body.error.code).toBe('REGISTRATION_CLOSED');
    const submit = await send(
      w.coachA,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'SUBMITTED' },
      await appVersion(w.coachA, app.id),
    );
    expect(submit.body.error.code).toBe('REGISTRATION_CLOSED');
    const create = await send(w.coachA, 'post', `/api/v1/competitions/${w.competitionId}/applications`, {
      organizationId: w.clubA,
    });
    expect(create.body.error.code).toBe('REGISTRATION_CLOSED');
  });

  it('two secretaries approving the same application at once: one wins, the other gets CONFLICT', async () => {
    const w = await world();
    const app = await application(w, w.coachA, w.clubA);
    const e = await addEntry(w, w.coachA, app.id, w.athletes.boy1, '-38');
    await send(
      w.coachA,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'SUBMITTED' },
      await appVersion(w.coachA, app.id),
    ).expect(200);
    const [a, b] = await Promise.all([
      send(
        w.secretary,
        'post',
        `/api/v1/entries/${e.body.data.id}/decision`,
        { decision: 'APPROVED' },
        e.body.data.version,
      ),
      send(
        w.secretary2,
        'post',
        `/api/v1/entries/${e.body.data.id}/decision`,
        { decision: 'APPROVED' },
        e.body.data.version,
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)?.body.error.code).toBe('VERSION_CONFLICT');

    const v = await appVersion(w.secretary, app.id);
    const [x, y] = await Promise.all([
      send(w.secretary, 'post', `/api/v1/applications/${app.id}/transitions`, { to: 'APPROVED' }, v),
      send(w.secretary2, 'post', `/api/v1/applications/${app.id}/transitions`, { to: 'APPROVED' }, v),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.status === 409)?.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      category: 'CONFLICT',
    });
  });
});

describe('entries after submission', () => {
  it('transfers and merges keep the declared category; incompatible transfers are refused', async () => {
    const w = await world();
    const app = await application(w, w.coachA, w.clubA);
    const boy = await addEntry(w, w.coachA, app.id, w.athletes.boy1, '-35');
    const girl = await addEntry(w, w.coachA, app.id, w.athletes.girl, '-34');
    await send(
      w.coachA,
      'post',
      `/api/v1/applications/${app.id}/transitions`,
      { to: 'SUBMITTED' },
      await appVersion(w.coachA, app.id),
    ).expect(200);

    const wrong = await send(
      w.secretary,
      'post',
      `/api/v1/entries/${girl.body.data.id}/transfer-category`,
      { toCategoryId: w.cat('-38').id, reason: 'Перевес на весах' },
      girl.body.data.version,
    );
    expect(wrong.body.error).toMatchObject({
      code: 'CATEGORY_INCOMPATIBLE',
      details: { reasons: ['GENDER_MISMATCH'] },
    });
    const moved = await send(
      w.secretary,
      'post',
      `/api/v1/entries/${boy.body.data.id}/transfer-category`,
      { toCategoryId: w.cat('-38').id, reason: 'Перевес на весах' },
      boy.body.data.version,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.data.category.id).toBe(w.cat('-38').id);
    expect(moved.body.data.declaredCategory.id).toBe(w.cat('-35').id);

    // Объединение «свыше 38» в «до 38»: участия переносятся, заявленная категория сохраняется.
    const heavy = await application(w, w.coachB, w.clubB);
    const b = await addEntry(w, w.coachB, heavy.id, w.athletes.boyB, '38+');
    const merged = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${w.competitionId}/categories/merge`,
      {
        sourceCategoryIds: [w.cat('38+').id],
        targetCategoryId: w.cat('-38').id,
        reason: 'Один участник в категории',
      },
    );
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body.data).toMatchObject({
      weight: { kind: 'ABOVE', lowerGrams: 35000, upperGrams: null },
      entries: { active: 2 },
    });
    expect(merged.body.data.name.ru).toMatch(/свыше 35 кг$/);
    const after = await w.coachB.agent.get(`/api/v1/applications/${heavy.id}`).expect(200);
    expect(after.body.data.entries[0]).toMatchObject({
      id: b.body.data.id,
      category: { id: w.cat('-38').id },
      declaredCategory: { id: w.cat('38+').id },
    });
  });

  it('the coach withdraws before the deadline; afterwards only the tournament staff can', async () => {
    const w = await world();
    const app = await application(w, w.coachA, w.clubA);
    const e1 = await addEntry(w, w.coachA, app.id, w.athletes.boy1, '-38');
    const e2 = await addEntry(w, w.coachA, app.id, w.athletes.boy2, '-35');
    const withdrawn = await send(
      w.coachA,
      'post',
      `/api/v1/entries/${e1.body.data.id}/withdraw`,
      { reason: 'Травма на тренировке' },
      e1.body.data.version,
    );
    expect(withdrawn.body.data).toMatchObject({
      status: 'WITHDRAWN',
      withdrawReason: 'Травма на тренировке',
    });

    const c = await w.organizer.agent.get(`/api/v1/competitions/${w.competitionId}`).expect(200);
    await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${w.competitionId}/transitions`,
      { to: 'REGISTRATION_CLOSED' },
      c.body.data.version,
    ).expect(200);
    const tooLate = await send(
      w.coachA,
      'post',
      `/api/v1/entries/${e2.body.data.id}/withdraw`,
      { reason: 'Передумали ехать' },
      e2.body.data.version,
    );
    expect(tooLate.body.error.code).toBe('REGISTRATION_CLOSED');
    const staff = await send(
      w.organizer,
      'post',
      `/api/v1/entries/${e2.body.data.id}/withdraw`,
      { reason: 'Не прибыл на турнир' },
      e2.body.data.version,
    );
    expect(staff.status, JSON.stringify(staff.body)).toBe(200);

    // Право записи у площадочного узла — решения по участникам в облаке не принимаются.
    await t.admin.competitionWriteLease.update({
      where: { competitionId: w.competitionId },
      data: { holderType: 'NODE', holderNodeId: uuidv7(), epoch: 2 },
    });
    const refused = await send(
      w.secretary,
      'post',
      `/api/v1/entries/${e2.body.data.id}/decision`,
      { decision: 'APPROVED' },
      3,
    );
    expect(refused.body.error.code).toBe('WRITE_AUTHORITY_ELSEWHERE');
  });

  it("an athlete's card lists their entries across competitions", async () => {
    const w = await world();
    const app = await application(w, w.coachA, w.clubA);
    await addEntry(w, w.coachA, app.id, w.athletes.boy1, '-38');
    const list = await w.coachA.agent.get(`/api/v1/athletes/${w.athletes.boy1}/entries`).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].competition).toMatchObject({ id: w.competitionId, status: 'REGISTRATION_OPEN' });
    await w.coachB.agent.get(`/api/v1/athletes/${w.athletes.boy1}/entries`).expect(404);
    const mine = await w.coachA.agent.get('/api/v1/me/applications').expect(200);
    expect(mine.body.data.map((a: { id: string }) => a.id)).toEqual([app.id]);
  });
});
