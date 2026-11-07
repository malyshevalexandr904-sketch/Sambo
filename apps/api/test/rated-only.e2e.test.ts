// Переход на рейтинговую систему (docs/RATED_ONLY.md): турнир создаёт только платформа, организации подают заявки
// на проведение — одобрение создаёт черновик рейтингового турнира; дивизионы спортсменов по возрасту задаёт
// администратор, кабинет показывает дивизион спортсмена.
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
import { send } from './helpers/phase3';
import { categoryTemplate, clubAthlete, isoDate, publishedRuleSet } from './helpers/phase4';

let t: TestApp;
let admin: Session;
let clubId: string;
let manager: Session;
let managerId: string;
let ageGroupId: string;

const day = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  admin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, { totp: true });
  clubId = await createOrg(t);
  const m = await createUser(t, { orgs: [{ organizationId: clubId, role: 'CLUB_MANAGER' }] });
  managerId = m.id;
  manager = await login(t, m.email);
  ({ ageGroupId } = await categoryTemplate(t));
});
afterAll(async () => {
  await t.close();
});

const request = (over: Record<string, unknown> = {}) => {
  const start = new Date(Date.now() + 30 * day);
  return {
    organizationId: clubId,
    name: 'Кубок клуба по самбо',
    startDate: isoDate(start),
    address: 'г. Казань, ул. Спортивная, 1, СК «Олимп»',
    ageGroupIds: [ageGroupId],
    matCount: 2,
    equipment: 'PARTIAL',
    refereeTeam: 'NONE',
    gender: 'SEPARATE',
    responsible: { kind: 'SELF' },
    contact: { channel: 'EMAIL', value: 'org@test.local' },
    rulesAccepted: true,
    comment: 'Просим двух судей категории ВК',
    ...over,
  };
};

interface RequestBody {
  id: string;
  version: number;
  status: string;
  competitionId: string | null;
  allowedActions: string[];
}

async function submit(over: Record<string, unknown> = {}): Promise<RequestBody> {
  const res = await send(manager, 'post', '/api/v1/competition-requests', request(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as RequestBody;
}

describe('competition hosting requests', () => {
  it('an organization submits a request; only it and the platform see it; the schedule is validated', async () => {
    const r = await submit();
    expect(r).toMatchObject({ status: 'SUBMITTED', competitionId: null, allowedActions: ['withdraw'] });

    const bad = await send(
      manager,
      'post',
      '/api/v1/competition-requests',
      request({ rulesAccepted: false, matCount: 0 }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toEqual(
      expect.arrayContaining([
        { path: 'rulesAccepted', code: 'consent_required' },
        { path: 'matCount', code: 'required' },
      ]),
    );
    // Возрастная группа — только шаблон платформы; ответственный — зарегистрированный пользователь.
    const foreign = await send(
      manager,
      'post',
      '/api/v1/competition-requests',
      request({ ageGroupIds: ['0192f0c4-0000-7000-8000-00000000abcd'] }),
    );
    expect(foreign.body.error.details.fields).toEqual([{ path: 'ageGroupIds', code: 'not_found' }]);
    const nobody = await send(
      manager,
      'post',
      '/api/v1/competition-requests',
      request({ responsible: { kind: 'USER', userId: '0192f0c4-0000-7000-8000-00000000abcd' } }),
    );
    expect(nobody.body.error.details.fields).toEqual([
      { path: 'responsible.userId', code: 'user_not_found' },
    ]);

    // Ответственного ищут по ФИО или почте: только активные, почта скрыта наполовину; тренер клуба искать не может.
    const judge = await createUser(t, { email: 'glavsudya.petrov@example.com' });
    await createUser(t, { email: 'glavsudya.blocked@example.com', status: 'BLOCKED' });
    const search = await manager.agent
      .get('/api/v1/competition-requests/responsible-candidates?q=glavsudya')
      .expect(200);
    expect(search.body.data).toEqual([
      { id: judge.id, displayName: expect.any(String), maskedEmail: 'gl**************@example.com' },
    ]);
    await manager.agent.get('/api/v1/competition-requests/responsible-candidates?q=gl').expect(400);
    const chosen = await submit({
      name: 'Турнир с главным судьёй',
      responsible: { kind: 'USER', userId: judge.id },
    });
    const chosenView = await admin.agent.get(`/api/v1/competition-requests/${chosen.id}`).expect(200);
    expect(chosenView.body.data.proposal.responsible).toMatchObject({
      kind: 'USER',
      userId: judge.id,
      email: 'glavsudya.petrov@example.com',
    });

    // Тренер клуба заявку не подаёт; чужая организация её не видит.
    const coach = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: clubId, role: 'COACH' }] })).email,
    );
    expect((await send(coach, 'post', '/api/v1/competition-requests', request())).status).toBe(403);
    await coach.agent.get('/api/v1/competition-requests/responsible-candidates?q=test').expect(403);
    const otherClub = await createOrg(t);
    const other = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: otherClub, role: 'CLUB_MANAGER' }] })).email,
    );
    await other.agent.get(`/api/v1/competition-requests/${r.id}`).expect(404);
    const otherList = await other.agent.get('/api/v1/competition-requests').expect(200);
    expect(otherList.body.data).toEqual([]);

    const adminView = await admin.agent.get(`/api/v1/competition-requests/${r.id}`).expect(200);
    expect(adminView.body.data).toMatchObject({
      organization: { id: clubId },
      submittedBy: { id: managerId },
      startDate: request().startDate,
      endDate: request().startDate,
      ageGroups: [{ id: ageGroupId, ageFrom: 12, ageTo: 13 }],
      requirements: { laptops: 2, tvs: 2, matHeads: 2, arbiters: 2, sideJudges: 2, timekeepers: 2 },
      proposal: {
        address: 'г. Казань, ул. Спортивная, 1, СК «Олимп»',
        matCount: 2,
        equipment: 'PARTIAL',
        refereeTeam: 'NONE',
        gender: 'SEPARATE',
        responsible: { kind: 'SELF', userId: managerId },
      },
      comment: 'Просим двух судей категории ВК',
      allowedActions: ['approve', 'reject'],
    });
    const pending = await admin.agent.get('/api/v1/competition-requests?status=SUBMITTED').expect(200);
    expect(pending.body.data.map((x: { id: string }) => x.id)).toContain(r.id);
  });

  it('the platform approves: a rated draft for the organization, managed by the platform; decided once', async () => {
    const contact = { kind: 'CONTACT', fullName: 'Петров Пётр', phone: '+79991234567' };
    const r = await submit({ name: 'Первенство клуба', responsible: contact });
    // Организация сама не одобряет.
    expect(
      (await send(manager, 'post', `/api/v1/competition-requests/${r.id}/approve`, {}, r.version)).status,
    ).toBe(403);
    const approved = await send(admin, 'post', `/api/v1/competition-requests/${r.id}/approve`, {}, r.version);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const done = approved.body.data as RequestBody;
    // Стадия «На согласовании»: турнир готовит платформа, опубликовать его может организатор (или платформа).
    expect(done).toMatchObject({ status: 'APPROVED', allowedActions: ['publish'] });
    const competition = await t.admin.competition.findUniqueOrThrow({
      where: { id: done.competitionId! },
      include: { ratingConfig: true },
    });
    expect(competition).toMatchObject({
      name: 'Первенство клуба',
      status: 'DRAFT',
      competitionType: 'RATED',
      organizerOrganizationId: clubId,
    });
    expect(competition.ratingConfig).not.toBeNull();
    // Адрес и ответственный переходят в черновик; сроки регистрации — до начала дня турнира, их уточнит платформа.
    expect(competition.descriptionMd).toContain('г. Казань, ул. Спортивная, 1');
    expect(competition.contactInfo).toEqual({ name: 'Петров Пётр', phone: '+79991234567' });
    expect(competition.registrationEndsAt.getTime()).toBeGreaterThan(
      competition.registrationStartsAt.getTime(),
    );
    // Дальше турниром управляет платформа: автору заявки роль руководителя турнира не выдаётся.
    const staff = await t.admin.competitionMembership.findMany({ where: { competitionId: competition.id } });
    expect(staff).toEqual([]);
    expect(
      (await manager.agent.get(`/api/v1/competitions/${competition.id}`)).body.data?.allowedActions ?? [],
    ).not.toContain('competition.update');
    const audit = await t.admin.auditLog.findFirstOrThrow({
      where: { action: 'competition_request.approved', entityId: r.id },
    });
    expect(audit).toMatchObject({ competitionId: competition.id, platformIntervention: true });

    const again = await send(admin, 'post', `/api/v1/competition-requests/${r.id}/approve`, {}, done.version);
    expect(again.body.error.code).toBe('COMPETITION_REQUEST_NOT_PENDING');
    const stale = await send(
      admin,
      'post',
      `/api/v1/competition-requests/${r.id}/reject`,
      { reason: 'Поздно' },
      1,
    );
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('the organization gets a draft regulation (PDF) right after submitting; strangers do not', async () => {
    const r = await submit({ name: 'Турнир с положением' });
    const pdf = await manager.agent.get(`/api/v1/competition-requests/${r.id}/regulation.pdf`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(
      Buffer.from(pdf.body as Buffer)
        .subarray(0, 5)
        .toString('latin1'),
    ).toBe('%PDF-');
    await admin.agent.get(`/api/v1/competition-requests/${r.id}/regulation.pdf?download=1`).expect(200);
    const otherOrg = await createOrg(t);
    const stranger = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: otherOrg, role: 'CLUB_MANAGER' }] })).email,
    );
    await stranger.agent.get(`/api/v1/competition-requests/${r.id}/regulation.pdf`).expect(404);
    await t.http().get(`/api/v1/competition-requests/${r.id}/regulation.pdf`).expect(401);
  });

  it('the platform rejects with a reason; the organization withdraws its own pending request', async () => {
    const r = await submit({ name: 'Турнир на отклонение' });
    const noReason = await send(admin, 'post', `/api/v1/competition-requests/${r.id}/reject`, {}, r.version);
    expect(noReason.status).toBe(400);
    const rejected = await send(
      admin,
      'post',
      `/api/v1/competition-requests/${r.id}/reject`,
      { reason: 'Даты совпадают с первенством региона' },
      r.version,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Даты совпадают с первенством региона',
      competitionId: null,
    });

    const w = await submit({ name: 'Турнир на отзыв' });
    expect(
      (await send(admin, 'post', `/api/v1/competition-requests/${w.id}/withdraw`, {}, w.version)).status,
    ).toBe(403);
    const withdrawn = await send(
      manager,
      'post',
      `/api/v1/competition-requests/${w.id}/withdraw`,
      {},
      w.version,
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.status).toBe('WITHDRAWN');
    const late = await send(
      admin,
      'post',
      `/api/v1/competition-requests/${w.id}/approve`,
      {},
      withdrawn.body.data.version,
    );
    expect(late.body.error.code).toBe('COMPETITION_REQUEST_NOT_PENDING');
  });
});

describe('tournament stages (05.11.2026)', () => {
  it('draft → review → organizer publishes → registration opens for followers', async () => {
    // Черновик: сохраняется как есть, виден только организации.
    const saved = await send(manager, 'post', '/api/v1/competition-requests/drafts', {
      organizationId: clubId,
      name: 'Осенний турнир',
      data: { name: 'Осенний турнир', matCount: 2 },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const draftId = saved.body.data.id as string;
    expect(saved.body.data).toMatchObject({
      status: 'DRAFT',
      allowedActions: ['edit', 'discard'],
      draft: { name: 'Осенний турнир', matCount: 2 },
    });
    const updated = await send(manager, 'put', `/api/v1/competition-requests/${draftId}/draft`, {
      organizationId: clubId,
      name: 'Осенний турнир клуба',
      data: { name: 'Осенний турнир клуба', matCount: 3 },
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.name).toBe('Осенний турнир клуба');
    await admin.agent.get(`/api/v1/competition-requests/${draftId}`).expect(404);
    const adminList = await admin.agent.get('/api/v1/competition-requests?limit=100').expect(200);
    expect(adminList.body.data.map((x: { id: string }) => x.id)).not.toContain(draftId);

    // Подача черновика: та же заявка становится поданной («На согласовании»).
    const submitted = await submit({ name: 'Осенний турнир клуба', draftId });
    expect(submitted).toMatchObject({ id: draftId, status: 'SUBMITTED' });
    const approved = await send(
      admin,
      'post',
      `/api/v1/competition-requests/${draftId}/approve`,
      {},
      submitted.version,
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const competitionId = approved.body.data.competitionId as string;
    expect(approved.body.data.competition).toMatchObject({ id: competitionId, status: 'DRAFT' });

    const root = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
    // Пока платформа не подготовила турнир (правила, категории), опубликовать его нельзя.
    const early = await send(manager, 'post', `/api/v1/competition-requests/${draftId}/publish`, {});
    expect(early.status).toBe(422);
    const c = await root.agent.get(`/api/v1/competitions/${competitionId}`).expect(200);
    const withRules = await send(
      root,
      'patch',
      `/api/v1/competitions/${competitionId}`,
      { ruleSetVersionId: await publishedRuleSet(t) },
      c.body.data.version,
    );
    expect(withRules.status, JSON.stringify(withRules.body)).toBe(200);
    const { templateId } = await categoryTemplate(t);
    await send(root, 'post', `/api/v1/competitions/${competitionId}/categories/generate`, {
      templateId,
    }).expect(201);

    const published = await send(manager, 'post', `/api/v1/competition-requests/${draftId}/publish`, {});
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.data).toMatchObject({ competition: { status: 'PUBLISHED' }, allowedActions: [] });
    const slug = published.body.data.competition.slug as string;
    const pub = await t.http().get(`/api/public/v1/competitions/${slug}`).expect(200);
    expect(pub.body.data).toMatchObject({ status: 'PUBLISHED', registrationOpenNow: false });
    expect(
      (await t.http().get(`/api/public/v1/competitions/${slug}/brackets`).expect(200)).body.data,
    ).toEqual({
      categories: [],
    });

    // Подписка на начало регистрации и шаблон афиши.
    const fan = await login(t, (await createUser(t)).email);
    const followed = await send(fan, 'put', `/api/v1/competitions/${competitionId}/follow`, { follow: true });
    expect(followed.status, JSON.stringify(followed.body)).toBe(200);
    expect(
      (await fan.agent.get(`/api/v1/competitions/${competitionId}`).expect(200)).body.data.followed,
    ).toBe(true);
    expect(
      (
        await send(manager, 'put', `/api/v1/competitions/${competitionId}/presentation`, {
          posterTemplate: 'arena',
        })
      ).status,
    ).toBe(403);
    await send(root, 'put', `/api/v1/competitions/${competitionId}/presentation`, {
      posterTemplate: 'arena',
      liveStreamUrl: 'https://vk.com/video-1_2',
    }).expect(204);

    // Администратор открывает регистрацию — событие для уведомления подписавшихся.
    const current = await root.agent.get(`/api/v1/competitions/${competitionId}`).expect(200);
    expect(current.body.data).toMatchObject({ status: 'PUBLISHED', posterTemplate: 'arena' });
    const opened = await send(
      root,
      'post',
      `/api/v1/competitions/${competitionId}/transitions`,
      { to: 'REGISTRATION_OPEN' },
      current.body.data.version,
    );
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body.data.registrationOpenNow).toBe(true);
    const events = await t.admin.outboxEvent.findMany({
      where: { competitionId, type: 'competition.status_changed' },
    });
    expect(events.map((e) => e.payload)).toContainEqual({
      competitionId,
      from: 'PUBLISHED',
      to: 'REGISTRATION_OPEN',
    });
    // Медиа — только после завершения турнира.
    const media = await send(root, 'post', `/api/v1/competitions/${competitionId}/media`, {
      kind: 'VIDEO',
      url: 'https://vk.com/video-1_3',
    });
    expect(media.body.error.code).toBe('COMPETITION_STAGE_MISMATCH');
  });
});

describe('divisions by age', () => {
  it('the platform admin sets non-overlapping divisions; everyone signed in reads them', async () => {
    const create = (body: Record<string, unknown>) => send(admin, 'post', '/api/v1/admin/divisions', body);
    const kids = await create({ name: 'Дети', minAge: null, maxAge: 11 });
    expect(kids.status, JSON.stringify(kids.body)).toBe(201);
    expect((await create({ name: 'Юноши', minAge: 12, maxAge: 15 })).status).toBe(201);
    const overlap = await create({ name: 'Подростки', minAge: 10, maxAge: 13 });
    expect(overlap.status).toBe(422);
    expect(overlap.body.error.code).toBe('DIVISION_OVERLAP');
    const inverted = await create({ name: 'Наоборот', minAge: 20, maxAge: 18 });
    expect(inverted.body.error.details.fields).toEqual([{ path: 'maxAge', code: 'age_range_invalid' }]);
    expect(
      (await send(manager, 'post', '/api/v1/admin/divisions', { name: 'Свой', minAge: 30, maxAge: 40 }))
        .status,
    ).toBe(403);

    // Изменение с версией: «Юноши» до 17 лет; «Взрослые» — с 18 без верхней границы.
    const list = await manager.agent.get('/api/v1/divisions').expect(200);
    expect(list.body.data).toMatchObject({
      agePolicy: 'BY_BIRTH_YEAR',
      divisions: [{ name: 'Дети' }, { name: 'Юноши' }],
    });
    const youth = list.body.data.divisions[1] as { id: string; version: number };
    const patched = await send(
      admin,
      'patch',
      `/api/v1/admin/divisions/${youth.id}`,
      { maxAge: 17 },
      youth.version,
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await create({ name: 'Взрослые', minAge: 18, maxAge: null })).status).toBe(201);

    // Кабинет: дивизион по году рождения; с правилом «полных лет» спортсмен до дня рождения — младше.
    const year = new Date().getUTCFullYear();
    const { athleteId } = await clubAthlete(t, { clubId, birthDate: `${year - 12}-12-31` });
    const byYear = await manager.agent.get(`/api/v1/athletes/${athleteId}/rating-progress`).expect(200);
    expect(byYear.body.data).toMatchObject({
      division: { name: 'Юноши', age: 12, minAge: 12, maxAge: 17 },
      rating: null,
      bouts: [],
    });
    const policy = await send(admin, 'put', '/api/v1/admin/divisions/age-policy', {
      agePolicy: 'EXACT_ON_DATE',
    });
    expect(policy.status).toBe(200);
    const exact = await manager.agent.get(`/api/v1/athletes/${athleteId}/rating-progress`).expect(200);
    expect(exact.body.data.division).toMatchObject({ name: 'Дети', age: 11, agePolicy: 'EXACT_ON_DATE' });

    // Удалённый дивизион: спортсмен без дивизиона.
    const kidsId = kids.body.data.id as string;
    await send(admin, 'delete', `/api/v1/admin/divisions/${kidsId}`).expect(204);
    const none = await manager.agent.get(`/api/v1/athletes/${athleteId}/rating-progress`).expect(200);
    expect(none.body.data.division).toBeNull();
    await send(admin, 'put', '/api/v1/admin/divisions/age-policy', { agePolicy: 'BY_BIRTH_YEAR' }).expect(
      200,
    );
  });
});
