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
import { clubAthlete, isoDate } from './helpers/phase4';

let t: TestApp;
let admin: Session;
let clubId: string;
let manager: Session;
let managerId: string;

const day = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  admin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, { totp: true });
  clubId = await createOrg(t);
  const m = await createUser(t, { orgs: [{ organizationId: clubId, role: 'CLUB_MANAGER' }] });
  managerId = m.id;
  manager = await login(t, m.email);
});
afterAll(async () => {
  await t.close();
});

const request = (over: Record<string, unknown> = {}) => {
  const start = new Date(Date.now() + 30 * day);
  return {
    organizationId: clubId,
    name: 'Кубок клуба по самбо',
    level: 'CLUB',
    disciplineCode: 'SPORT_SAMBO',
    timezone: 'Europe/Moscow',
    startDate: isoDate(start),
    endDate: isoDate(start),
    registrationStartsAt: new Date(Date.now() - day).toISOString(),
    registrationEndsAt: new Date(Date.now() + 20 * day).toISOString(),
    expectedParticipants: 60,
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
      request({ endDate: isoDate(new Date(Date.now() + 29 * day)) }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toEqual(
      expect.arrayContaining([{ path: 'endDate', code: 'end_before_start' }]),
    );

    // Тренер клуба заявку не подаёт; чужая организация её не видит.
    const coach = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: clubId, role: 'COACH' }] })).email,
    );
    expect((await send(coach, 'post', '/api/v1/competition-requests', request())).status).toBe(403);
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
      expectedParticipants: 60,
      comment: 'Просим двух судей категории ВК',
      allowedActions: ['approve', 'reject'],
    });
    const pending = await admin.agent.get('/api/v1/competition-requests?status=SUBMITTED').expect(200);
    expect(pending.body.data.map((x: { id: string }) => x.id)).toContain(r.id);
  });

  it('the platform approves: a rated draft for the organization, its author manages it; decided once', async () => {
    const r = await submit({ name: 'Первенство клуба' });
    // Организация сама не одобряет.
    expect(
      (await send(manager, 'post', `/api/v1/competition-requests/${r.id}/approve`, {}, r.version)).status,
    ).toBe(403);
    const approved = await send(admin, 'post', `/api/v1/competition-requests/${r.id}/approve`, {}, r.version);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const done = approved.body.data as RequestBody;
    expect(done).toMatchObject({ status: 'APPROVED', allowedActions: [] });
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
    // Руководитель клуба турниром по своей роли не управляет — он руководитель турнира.
    const staff = await t.admin.competitionMembership.findMany({
      where: { competitionId: competition.id },
      include: { role: true },
    });
    expect(staff.map((s) => [s.userId, s.role.code, s.status])).toEqual([
      [managerId, 'TOURNAMENT_MANAGER', 'ACTIVE'],
    ]);
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
