// Допуск, прибытие, взвешивание, медицинский допуск (Phase 4b): инварианты раздела 53 «допуск без документов» и
// «допуск без взвешивания», QR без ПДн, исход взвешивания по положению (D-06), доступ к медданным.
import { uuidv7 } from '@sde/db';
import { PrismaClient } from '@sde/db';
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
import { competitionStaff, givePerson, PDF, publishConsentTemplates, send, upload } from './helpers/phase3';
import { categoryTemplate, clubAthlete, isoDate, publishedRuleSet } from './helpers/phase4';
import { TEST_ENV } from './test-env';

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
const hour = 60 * 60 * 1000;

interface World {
  competitionId: string;
  organizer: Session;
  secretary: Session;
  medic: Session;
  coach: Session;
  clubId: string;
  categories: { id: string; code: string; version: number }[];
  entries: Record<'boy1' | 'boy2', { id: string; athleteId: string }>;
  applicationId: string;
}

const cat = (w: World, suffix: string) =>
  w.categories.find((c) => c.code.endsWith(suffix)) as World['categories'][number];

async function competitionVersion(s: Session, id: string): Promise<number> {
  return (await s.agent.get(`/api/v1/competitions/${id}`).expect(200)).body.data.version;
}

async function transition(s: Session, id: string, to: string, extra: Record<string, unknown> = {}) {
  const r = await send(
    s,
    'post',
    `/api/v1/competitions/${id}/transitions`,
    { to, ...extra },
    await competitionVersion(s, id),
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r;
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

/**
 * Турнир с требованиями положения (свидетельство о рождении, согласие, медицинский допуск, взвешивание,
 * прибытие), одобренная заявка клуба с двумя спортсменами в категории «до 38 кг».
 */
async function world(opts: { outcome?: 'WITHDRAW' | 'RECHECK' | 'TRANSFER' } = {}): Promise<World> {
  const organizerOrgId = await createOrg(t, { type: 'ORGANIZER' });
  const organizerUser = await createUser(t, {
    orgs: [{ organizationId: organizerOrgId, role: 'ORGANIZER' }],
  });
  const organizer = await login(t, organizerUser.email);
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
    ruleSetVersionId: await publishedRuleSet(t),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const competitionId = created.body.data.id as string;
  const generated = await send(
    organizer,
    'post',
    `/api/v1/competitions/${competitionId}/categories/generate`,
    {
      templateId,
    },
  );
  await send(organizer, 'put', `/api/v1/competitions/${competitionId}/requirements`, {
    requirements: [
      { kind: 'DOCUMENT', documentTypeCode: 'BIRTH_CERTIFICATE' },
      { kind: 'CONSENT', consentKind: 'PD_PROCESSING' },
      { kind: 'MEDICAL_CLEARANCE' },
      { kind: 'WEIGH_IN' },
      { kind: 'CHECK_IN' },
    ],
  }).expect(200);
  if (opts.outcome)
    await send(
      organizer,
      'put',
      `/api/v1/competitions/${competitionId}/regulation`,
      { requirementsMd: 'Положение', weighInFailureOutcome: opts.outcome },
      await competitionVersion(organizer, competitionId),
    ).expect(200);
  await transition(organizer, competitionId, 'REGISTRATION_OPEN');

  const secretaryUser = await createUser(t);
  await competitionStaff(t, secretaryUser.id, competitionId, 'SECRETARY');
  const medicUser = await createUser(t);
  await competitionStaff(t, medicUser.id, competitionId, 'MEDICAL_STAFF');
  const clubId = await createOrg(t);
  const coach = await coachOf(clubId);
  const year = start.getUTCFullYear() - 12;
  const pd = consents.PD_PROCESSING as string;
  const boy1 = await clubAthlete(t, {
    clubId,
    birthDate: `${year}-04-01`,
    lastName: 'Алексеев',
    consentTemplateId: pd,
  });
  const boy2 = await clubAthlete(t, {
    clubId,
    birthDate: `${year}-06-01`,
    lastName: 'Борисов',
    consentTemplateId: pd,
  });
  const categories = generated.body.data as World['categories'];

  const app = await send(coach, 'post', `/api/v1/competitions/${competitionId}/applications`, {
    organizationId: clubId,
  });
  expect(app.status, JSON.stringify(app.body)).toBe(201);
  const applicationId = app.body.data.id as string;
  const minus38 = categories.find((c) => c.code.endsWith('-38'))?.id;
  for (const a of [boy1, boy2])
    await send(coach, 'post', `/api/v1/applications/${applicationId}/entries`, {
      athleteId: a.athleteId,
      categoryId: minus38,
      declaredWeightGrams: 36_000,
    }).expect(201);
  const draft = await coach.agent.get(`/api/v1/applications/${applicationId}`).expect(200);
  await send(
    coach,
    'post',
    `/api/v1/applications/${applicationId}/transitions`,
    { to: 'SUBMITTED' },
    draft.body.data.version,
  ).expect(200);
  const secretary = await login(t, secretaryUser.email);
  const full = await secretary.agent.get(`/api/v1/applications/${applicationId}`).expect(200);
  const entries = {} as World['entries'];
  for (const e of full.body.data.entries as {
    id: string;
    version: number;
    athleteId: string;
    snapshot: { lastName: string };
  }[]) {
    await send(
      secretary,
      'post',
      `/api/v1/entries/${e.id}/decision`,
      { decision: 'APPROVED' },
      e.version,
    ).expect(200);
    entries[e.snapshot.lastName === 'Алексеев' ? 'boy1' : 'boy2'] = { id: e.id, athleteId: e.athleteId };
  }
  const reviewed = await secretary.agent.get(`/api/v1/applications/${applicationId}`).expect(200);
  await send(
    secretary,
    'post',
    `/api/v1/applications/${applicationId}/transitions`,
    { to: 'APPROVED' },
    reviewed.body.data.version,
  ).expect(200);
  return {
    competitionId,
    organizer,
    secretary,
    medic: await login(t, medicUser.email),
    coach,
    clubId,
    categories,
    entries,
    applicationId,
  };
}

async function birthCertificate(w: World, athleteId: string): Promise<{ id: string; version: number }> {
  const fileId = await upload(t, w.coach, 'DOCUMENT', PDF, 'application/pdf', 'свидетельство.pdf');
  const r = await send(w.coach, 'post', '/api/v1/documents', {
    typeCode: 'BIRTH_CERTIFICATE',
    fileId,
    owner: { athleteId },
    competitionId: w.competitionId,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.data.id as string, version: r.body.data.version as number };
}

const checks = (body: { data: { checks: { kind: string; status: string; reasonCode: string | null }[] } }) =>
  Object.fromEntries(
    body.data.checks.map((c) => [c.kind, `${c.status}${c.reasonCode ? `:${c.reasonCode}` : ''}`]),
  );

const admissionOf = (s: Session, entryId: string) => s.agent.get(`/api/v1/entries/${entryId}/admission`);

async function checkIn(w: World, athleteId: string, status: string, method = 'SEARCH') {
  const row = await w.secretary.agent
    .get(`/api/v1/competitions/${w.competitionId}/check-in`)
    .query({ limit: 100 })
    .expect(200);
  const current = row.body.data.find((r: { athlete: { id: string } }) => r.athlete.id === athleteId);
  return send(
    w.secretary,
    'post',
    `/api/v1/competitions/${w.competitionId}/check-in/${athleteId}`,
    { status, method },
    current?.checkIn.version ?? 1,
  );
}

function weigh(s: Session, entryId: string, body: Record<string, unknown>, key: string | null = uuidv7()) {
  const r = s.agent.post(`/api/v1/entries/${entryId}/weigh-ins`).set('x-csrf-token', s.csrf);
  if (key) r.set('idempotency-key', key);
  return r.send(body);
}

async function openWeighIn(w: World, categoryIds: string[]) {
  const scales = await send(w.organizer, 'post', `/api/v1/competitions/${w.competitionId}/scales`, {
    name: 'Весы 1',
    serialNumber: 'SN-001',
    verifiedUntil: isoDate(new Date(Date.now() + 365 * day)),
  });
  expect(scales.status, JSON.stringify(scales.body)).toBe(201);
  const expired = await send(w.organizer, 'post', `/api/v1/competitions/${w.competitionId}/scales`, {
    name: 'Старые весы',
    verifiedUntil: isoDate(new Date(Date.now() - 2 * day)),
  });
  const windows = await send(
    w.organizer,
    'post',
    `/api/v1/competitions/${w.competitionId}/weigh-in-windows`,
    {
      name: 'День 1, утро',
      startsAt: new Date(Date.now() - hour).toISOString(),
      endsAt: new Date(Date.now() + 2 * hour).toISOString(),
      kind: 'OFFICIAL',
      categoryIds,
    },
  );
  expect(windows.status, JSON.stringify(windows.body)).toBe(201);
  const byName = (list: { id: string; name: string; verified?: boolean }[], name: string) =>
    list.find((x) => x.name === name)?.id as string;
  return {
    scaleId: byName(expired.body.data, 'Весы 1'),
    expiredScaleId: byName(expired.body.data, 'Старые весы'),
    windowId: windows.body.data[0].id as string,
  };
}

describe('admission (G-06)', () => {
  it('checks come from the regulation; documents, consent, medical clearance, arrival and weight decide', async () => {
    const w = await world();
    const { boy1, boy2 } = w.entries;

    // Сразу после одобрения: документа нет — не допущен; остальное ждёт мандатной комиссии.
    const initial = await admissionOf(w.coach, boy1.id).expect(200);
    expect(initial.body.data.status).toBe('NOT_ADMITTED');
    expect(checks(initial.body)).toEqual({
      DOCUMENTS: 'FAILED:document_missing',
      CONSENTS: 'PASSED',
      MEDICAL: 'PENDING:medical_missing',
      WEIGHT: 'PENDING:weigh_in_expected',
      CHECK_IN: 'PENDING:check_in_expected',
    });
    expect(initial.body.data.allowedActions).toEqual([]);
    // Чужой тренер допуск не видит.
    const stranger = await coachOf(await createOrg(t));
    await admissionOf(stranger, boy1.id).expect(404);

    // Документ загружен — ждёт проверки; проверен — проверка пройдена (пересчёт в транзакции проверки).
    const doc = await birthCertificate(w, boy1.athleteId);
    expect(checks((await admissionOf(w.coach, boy1.id)).body).DOCUMENTS).toBe(
      'PENDING:document_not_verified',
    );
    await send(
      w.secretary,
      'post',
      `/api/v1/documents/${doc.id}/transitions`,
      { to: 'VERIFIED' },
      doc.version,
    ).expect(200);
    expect((await admissionOf(w.coach, boy1.id)).body.data.status).toBe('PENDING');

    // Мандатная комиссия: категории переходят к взвешиванию, строки прибытия созданы.
    await transition(w.organizer, w.competitionId, 'REGISTRATION_CLOSED');
    await transition(w.organizer, w.competitionId, 'CHECK_IN');
    const cats = await w.organizer.agent
      .get(`/api/v1/competitions/${w.competitionId}/categories`)
      .expect(200);
    expect(new Set(cats.body.data.map((c: { status: string }) => c.status))).toEqual(new Set(['WEIGH_IN']));
    expect(await t.admin.checkIn.count({ where: { competitionId: w.competitionId } })).toBe(2);
    const summary = await w.secretary.agent
      .get(`/api/v1/competitions/${w.competitionId}/check-in/summary`)
      .expect(200);
    expect(summary.body.data).toEqual({
      declared: 2,
      approved: 2,
      expected: 2,
      arrived: 0,
      notArrived: 0,
      withdrawn: 0,
      problemDocuments: 1,
    });

    // Прибытие по QR: тренер получает QR, секретарь сканирует (без смены статуса) и отмечает.
    const qr = await w.coach.agent.get(`/api/v1/entries/${boy1.id}/qr`).expect(200);
    expect(qr.body.data.svg).toContain('<svg');
    expect(qr.body.data.qrToken).not.toContain('Алексеев');
    const scanned = await w.secretary.agent
      .post(`/api/v1/competitions/${w.competitionId}/check-in/scan`)
      .set('x-csrf-token', w.secretary.csrf)
      .set('idempotency-key', uuidv7())
      .send({ qrToken: qr.body.data.qrToken })
      .expect(200);
    expect(scanned.body.data).toMatchObject({
      athlete: { id: boy1.athleteId, lastName: 'Алексеев' },
      checkIn: {
        status: 'EXPECTED',
        version: 1,
        allowedActions: ['set:ARRIVED', 'set:NOT_ARRIVED', 'set:WITHDRAWN'],
      },
    });
    const forged = await w.secretary.agent
      .post(`/api/v1/competitions/${w.competitionId}/check-in/scan`)
      .set('x-csrf-token', w.secretary.csrf)
      .set('idempotency-key', uuidv7())
      .send({ qrToken: `${qr.body.data.qrToken.slice(0, -2)}AA` });
    expect(forged.status).toBe(404);
    const arrived = await checkIn(w, boy1.athleteId, 'ARRIVED', 'QR');
    expect(arrived.status, JSON.stringify(arrived.body)).toBe(200);
    expect(arrived.body.data.checkIn).toMatchObject({ status: 'ARRIVED', method: 'QR', version: 2 });
    const stale = await send(
      w.secretary,
      'post',
      `/api/v1/competitions/${w.competitionId}/check-in/${boy1.athleteId}`,
      { status: 'WITHDRAWN', method: 'MANUAL' },
      1,
    );
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const back = await checkIn(w, boy1.athleteId, 'NOT_ARRIVED');
    expect(back.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { from: 'ARRIVED', allowed: ['WITHDRAWN'] },
    });

    // Медицина: только врач турнира; секретарь видит лишь итог проверки.
    await w.secretary.agent.get(`/api/v1/competitions/${w.competitionId}/medical`).expect(403);
    const clearance = await send(
      w.medic,
      'post',
      `/api/v1/competitions/${w.competitionId}/medical-clearances`,
      {
        athleteId: boy1.athleteId,
        validUntil: isoDate(new Date(Date.now() + 60 * day)),
        issuedBy: 'Врачебно-физкультурный диспансер № 1',
      },
    );
    expect(clearance.status, JSON.stringify(clearance.body)).toBe(201);
    const medicalList = await w.medic.agent
      .get(`/api/v1/competitions/${w.competitionId}/medical`)
      .expect(200);
    expect(medicalList.body.data.map((r: { state: string }) => r.state).sort()).toEqual(['MISSING', 'VALID']);
    expect(
      await t.admin.dataAccessLog.count({
        where: { resourceType: 'MedicalList', resourceId: w.competitionId },
      }),
    ).toBe(1);
    const secretaryView = await admissionOf(w.secretary, boy1.id).expect(200);
    const medical = secretaryView.body.data.checks.find((c: { kind: string }) => c.kind === 'MEDICAL');
    expect(medical).toMatchObject({ status: 'PASSED', reasonCode: null, reasonParams: null });

    // Взвешивание ещё не прошло — категория не готова к жеребьёвке (допуск не решён).
    const m38 = cat(w, '-38');
    const early = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${w.competitionId}/categories/${m38.id}/transitions`,
      { to: 'READY_FOR_DRAW' },
      (await w.organizer.agent.get(`/api/v1/competitions/${w.competitionId}/categories/${m38.id}`)).body.data
        .version,
    );
    expect(early.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['admission_pending'] },
    });

    // Взвешивание: RECHECK по умолчанию — неудачная официальная попытка требует повторной.
    const { scaleId, expiredScaleId, windowId } = await openWeighIn(w, [m38.id]);
    const overlap = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${w.competitionId}/weigh-in-windows`,
      {
        name: 'Пересекается',
        startsAt: new Date(Date.now()).toISOString(),
        endsAt: new Date(Date.now() + 3 * hour).toISOString(),
        categoryIds: [m38.id],
      },
    );
    expect(overlap.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ path: 'startsAt', code: 'window_overlap' }] },
    });
    const attempt = { windowId, scaleId, weightGrams: 38_500, kind: 'OFFICIAL' };
    expect((await weigh(w.secretary, boy1.id, attempt, null)).body.error.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect((await weigh(w.secretary, boy2.id, attempt)).body.error.code).toBe('NOT_CHECKED_IN');
    expect((await weigh(w.secretary, boy1.id, { ...attempt, scaleId: expiredScaleId })).body.error.code).toBe(
      'SCALE_CALIBRATION_EXPIRED',
    );
    expect((await weigh(w.coach, boy1.id, attempt)).status).toBe(403);
    const failed = await weigh(w.secretary, boy1.id, attempt);
    expect(failed.status, JSON.stringify(failed.body)).toBe(201);
    expect(failed.body.data).toMatchObject({
      attempt: {
        result: 'FAILED',
        weightGrams: 38_500,
        limits: { kind: 'UP_TO', lowerGrams: 35_000, upperGrams: 38_000 },
      },
      record: { status: 'RECHECK_REQUIRED', allowedKinds: ['RECHECK'] },
      admission: { status: 'PENDING' },
    });
    expect(failed.body.data.suggestedCategories).toBeUndefined();
    const again = await weigh(w.secretary, boy1.id, attempt);
    expect(again.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { from: 'RECHECK_REQUIRED', allowed: ['RECHECK'] },
    });
    const recheck = await weigh(w.secretary, boy1.id, { ...attempt, kind: 'RECHECK', weightGrams: 38_000 });
    expect(recheck.body.data).toMatchObject({
      record: { status: 'PASSED' },
      admission: { status: 'ADMITTED' },
    });

    // Попытки append-only: у роли приложения нет UPDATE и DELETE; история — владельцу заявки.
    const app = new PrismaClient({ datasourceUrl: TEST_ENV.DATABASE_URL });
    await expect(app.$executeRaw`UPDATE weigh_in_attempt SET weight_grams = 30000`).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$executeRaw`DELETE FROM weigh_in_attempt`).rejects.toThrow(/permission denied/);
    await app.$disconnect();
    const history = await w.coach.agent.get(`/api/v1/entries/${boy1.id}/weigh-ins`).expect(200);
    expect(history.body.data.map((a: { kind: string; result: string }) => `${a.kind}:${a.result}`)).toEqual([
      'OFFICIAL:FAILED',
      'RECHECK:PASSED',
    ]);

    // Исключение проверки — только с правом admission.override и причиной; пройденную не исключить.
    const waive = (s: Session, kind: string, reason = 'Оригинал свидетельства предъявлен на комиссии') =>
      send(s, 'post', `/api/v1/entries/${boy2.id}/admission/checks/${kind}/waive`, { reason });
    expect((await waive(w.secretary, 'DOCUMENTS')).status).toBe(403);
    expect((await waive(w.organizer, 'DOCUMENTS', 'нет')).body.error.code).toBe('VALIDATION_FAILED');
    expect((await waive(w.organizer, 'CONSENTS')).body.error.code).toBe('INVALID_TRANSITION');
    const waived = await waive(w.organizer, 'DOCUMENTS');
    expect(waived.status, JSON.stringify(waived.body)).toBe(200);
    expect(checks(waived.body).DOCUMENTS).toBe('WAIVED:document_missing');
    expect(waived.body.data.status).toBe('PENDING');
    expect(
      await t.admin.auditLog.count({ where: { action: 'admission.check_waived', entityId: boy2.id } }),
    ).toBe(1);

    // Не прибыл — не допущен; допуск решён по всем — категория готова к жеребьёвке.
    expect((await checkIn(w, boy2.athleteId, 'NOT_ARRIVED')).status).toBe(200);
    const list = await w.secretary.agent
      .get(`/api/v1/competitions/${w.competitionId}/admission`)
      .query({ problemsOnly: 'true' })
      .expect(200);
    expect(
      list.body.data.map((r: { entryId: string; admission: { status: string } }) => [
        r.entryId,
        r.admission.status,
      ]),
    ).toEqual([[boy2.id, 'NOT_ADMITTED']]);
    const ready = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${w.competitionId}/categories/${m38.id}/transitions`,
      { to: 'READY_FOR_DRAW' },
      (await w.organizer.agent.get(`/api/v1/competitions/${w.competitionId}/categories/${m38.id}`)).body.data
        .version,
    );
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    const competition = await w.organizer.agent.get(`/api/v1/competitions/${w.competitionId}`).expect(200);
    expect(competition.body.data.counters).toMatchObject({ arrived: 1, admitted: 1, notAdmitted: 1 });

    // Каждая операционная таблица пишет журнал синхронизации.
    const tables = await t.admin.syncLog.findMany({
      where: { competitionId: w.competitionId },
      distinct: ['tableName'],
      select: { tableName: true },
    });
    expect(tables.map((x) => x.tableName)).toEqual(
      expect.arrayContaining([
        'admission',
        'admission_check',
        'check_in',
        'scale',
        'weigh_in_window',
        'weigh_in_window_category',
        'weigh_in_attempt',
        'weigh_in_record',
      ]),
    );
  });
});

describe('weigh-in outcome by regulation (D-06)', () => {
  it('transfer: a failed weigh-in suggests matching categories; after the transfer the weight passes', async () => {
    const w = await world({ outcome: 'TRANSFER' });
    const { boy1 } = w.entries;
    await transition(w.organizer, w.competitionId, 'REGISTRATION_CLOSED');
    await transition(w.organizer, w.competitionId, 'CHECK_IN');
    const { scaleId, windowId } = await openWeighIn(w, [cat(w, '-38').id, cat(w, '38+').id]);
    expect((await checkIn(w, boy1.athleteId, 'ARRIVED')).status).toBe(200);
    const failed = await weigh(w.secretary, boy1.id, {
      windowId,
      scaleId,
      weightGrams: 40_000,
      kind: 'OFFICIAL',
    });
    expect(failed.body.data).toMatchObject({
      record: { status: 'FAILED', allowedKinds: [] },
      admission: { status: 'NOT_ADMITTED' },
      suggestedCategories: [{ id: cat(w, '38+').id, weight: { kind: 'ABOVE', lowerGrams: 38_000 } }],
    });
    const entry = await w.secretary.agent.get(`/api/v1/applications/${w.applicationId}`).expect(200);
    const version = entry.body.data.entries.find((e: { id: string }) => e.id === boy1.id).version;
    const moved = await send(
      w.secretary,
      'post',
      `/api/v1/entries/${boy1.id}/transfer-category`,
      { toCategoryId: cat(w, '38+').id, reason: 'Перевес на взвешивании, перевод по положению' },
      version,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const admission = await admissionOf(w.secretary, boy1.id).expect(200);
    expect(checks(admission.body).WEIGHT).toBe('PASSED');
    const row = await w.secretary.agent
      .get(`/api/v1/competitions/${w.competitionId}/weigh-in`)
      .query({ categoryId: cat(w, '38+').id })
      .expect(200);
    expect(row.body.data[0]).toMatchObject({
      entryId: boy1.id,
      record: { status: 'PASSED', allowedKinds: ['CONTROL'] },
    });
  });

  it('withdrawal: a failed weigh-in is final; the outcome cannot change once weigh-in has begun', async () => {
    const w = await world({ outcome: 'WITHDRAW' });
    const { boy2 } = w.entries;
    await transition(w.organizer, w.competitionId, 'REGISTRATION_CLOSED');
    await transition(w.organizer, w.competitionId, 'CHECK_IN');
    const { scaleId, windowId } = await openWeighIn(w, [cat(w, '-38').id]);
    expect((await checkIn(w, boy2.athleteId, 'ARRIVED')).status).toBe(200);
    const failed = await weigh(w.secretary, boy2.id, {
      windowId,
      scaleId,
      weightGrams: 34_000,
      kind: 'OFFICIAL',
    });
    expect(failed.body.data).toMatchObject({
      record: { status: 'FAILED' },
      admission: { status: 'NOT_ADMITTED' },
    });
    expect(failed.body.data.suggestedCategories).toBeUndefined();
    const change = await send(
      w.organizer,
      'put',
      `/api/v1/competitions/${w.competitionId}/regulation`,
      { requirementsMd: 'Положение', weighInFailureOutcome: 'RECHECK' },
      await competitionVersion(w.organizer, w.competitionId),
    );
    expect(change.body.error).toMatchObject({ details: { failed: ['weigh_in_started'] } });
  });
});

describe('medical clearance access (G-05)', () => {
  it('the guardian sees the clearances of the child; a coach does not; revoking fails the check', async () => {
    const w = await world();
    const { boy1 } = w.entries;
    const guardianUser = await createUser(t);
    const guardianPersonId = await givePerson(t, guardianUser.id, {
      lastName: 'Алексеева',
      firstName: 'Мария',
      birthDate: '1988-01-01',
    });
    await t.admin.guardian.create({
      data: {
        id: uuidv7(),
        athleteId: boy1.athleteId,
        guardianPersonId,
        relation: 'MOTHER',
        verifiedAt: new Date(),
        verificationBasis: 'DOCUMENT_SHOWN',
      },
    });
    const guardian = await login(t, guardianUser.email);
    await transition(w.organizer, w.competitionId, 'REGISTRATION_CLOSED');
    await transition(w.organizer, w.competitionId, 'CHECK_IN');
    const created = await send(
      w.medic,
      'post',
      `/api/v1/competitions/${w.competitionId}/medical-clearances`,
      {
        athleteId: boy1.athleteId,
        validUntil: isoDate(new Date(Date.now() + 60 * day)),
        issuedBy: 'Поликлиника № 5',
        competitionOnly: true,
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({ competitionId: w.competitionId, status: 'VALID' });
    const own = await guardian.agent.get(`/api/v1/athletes/${boy1.athleteId}/medical-clearances`).expect(200);
    expect(own.body.data).toHaveLength(1);
    await w.coach.agent.get(`/api/v1/athletes/${boy1.athleteId}/medical-clearances`).expect(404);
    await w.medic.agent
      .get(`/api/v1/athletes/${boy1.athleteId}/medical-clearances`)
      .query({ competitionId: w.competitionId })
      .expect(200);
    // Врач записывает допуск только участнику своего турнира.
    const outsider = await clubAthlete(t, { clubId: w.clubId });
    const foreign = await send(
      w.medic,
      'post',
      `/api/v1/competitions/${w.competitionId}/medical-clearances`,
      {
        athleteId: outsider.athleteId,
        validUntil: isoDate(new Date(Date.now() + 60 * day)),
        issuedBy: 'Поликлиника № 5',
      },
    );
    expect(foreign.status).toBe(404);
    const revoked = await send(
      w.medic,
      'post',
      `/api/v1/competitions/${w.competitionId}/medical-clearances/${created.body.data.id}/revoke`,
      { reason: 'Травма на разминке' },
    );
    expect(revoked.body.data).toMatchObject({ status: 'REVOKED', revokeReason: 'Травма на разминке' });
    expect(checks((await admissionOf(w.secretary, boy1.id)).body).MEDICAL).toBe('FAILED:medical_revoked');
    expect((await w.organizer.agent.get(`/api/v1/competitions/${w.competitionId}/medical`)).status).toBe(403);
  });
});
