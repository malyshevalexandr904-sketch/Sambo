// Правки 27.10.2026: открытый набор судей (организатор объявляет должности с требованиями, судья подаёт заявку,
// организатор одобряет — судья в персонале турнира — или отклоняет) и демо-вход (все роли, только просмотр).
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createTestApp,
  createUser,
  csrfAgent,
  login,
  resetData,
  type Session,
  type TestApp,
} from './helpers/app';
import { givePerson, send } from './helpers/phase3';
import { isoDate, platformAdminSession } from './helpers/phase4';

let t: TestApp;
let admin: Session;
let organizer: Session;
let organizerOrgId: string;

const day = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  admin = await platformAdminSession(t);
  organizerOrgId = await createOrg(t, { type: 'ORGANIZER' });
  const o = await createUser(t, { orgs: [{ organizationId: organizerOrgId, role: 'ORGANIZER' }] });
  organizer = await login(t, o.email);
});
afterAll(async () => {
  await t.close();
});

/** Судья с профилем (роль кабинета «Судья» без назначений в турнирах). */
async function referee(): Promise<{ id: string; session: Session }> {
  const u = await createUser(t);
  const personId = await givePerson(t, u.id, {
    lastName: 'Судьин',
    firstName: 'Пётр',
    birthDate: '1980-01-01',
  });
  await t.admin.refereeProfile.create({
    data: { id: uuidv7(), personId, refereeCategoryCode: 'CAT_3', status: 'ACTIVE' },
  });
  return { id: u.id, session: await login(t, u.email) };
}

async function createCompetition(refereeRecruitment?: unknown): Promise<string> {
  const start = new Date(Date.now() + 30 * day);
  const res = await send(admin, 'post', '/api/v1/competitions', {
    name: 'Кубок с набором судей',
    organizerOrganizationId: organizerOrgId,
    level: 'CLUB',
    disciplineCode: 'SPORT_SAMBO',
    timezone: 'Europe/Moscow',
    startDate: isoDate(start),
    endDate: isoDate(start),
    registrationStartsAt: new Date(Date.now() - day).toISOString(),
    registrationEndsAt: new Date(Date.now() + 20 * day).toISOString(),
    ...(refereeRecruitment ? { refereeRecruitment } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

interface Position {
  id: string;
  roleCode: string;
  requirements: string;
  status: string;
  version: number;
  applications: Array<{ id: string; status: string; version: number; applicant: { id: string } }>;
}

describe('open referee recruitment', () => {
  it('is announced at creation; a referee applies; the organizer approves or rejects', async () => {
    const competitionId = await createCompetition([
      { roleCode: 'REFEREE', requirements: 'Категория не ниже третьей' },
      { roleCode: 'SECRETARY', requirements: 'Опыт секретаря' },
    ]);
    const list = await organizer.agent
      .get(`/api/v1/competitions/${competitionId}/referee-recruitment`)
      .expect(200);
    const positions = list.body.data as Position[];
    expect(positions.map((p) => [p.roleCode, p.requirements, p.status])).toEqual([
      ['REFEREE', 'Категория не ниже третьей', 'OPEN'],
      ['SECRETARY', 'Опыт секретаря', 'OPEN'],
    ]);

    // Судья видит турнир, должности и требования; подаёт заявку один раз.
    const r1 = await referee();
    const open = await r1.session.agent.get('/api/v1/referee-recruitment').expect(200);
    expect(open.body.data).toEqual([
      expect.objectContaining({
        competition: expect.objectContaining({ id: competitionId, name: 'Кубок с набором судей' }),
        positions: [
          expect.objectContaining({ roleCode: 'REFEREE', myApplication: null }),
          expect.objectContaining({ roleCode: 'SECRETARY', myApplication: null }),
        ],
      }),
    ]);
    const refereePosition = positions[0]!;
    const applied = await send(
      r1.session,
      'post',
      `/api/v1/referee-recruitment/${refereePosition.id}/applications`,
    );
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect(applied.body.data[0].positions[0].myApplication).toMatchObject({ status: 'PENDING' });
    expect(
      (await send(r1.session, 'post', `/api/v1/referee-recruitment/${refereePosition.id}/applications`))
        .status,
    ).toBe(409);

    // Не судья наборы не видит; организатор без права турнира заявки не рассматривает.
    expect((await organizer.agent.get('/api/v1/referee-recruitment')).status).toBe(403);
    const stranger = await referee();
    await stranger.session.agent.get(`/api/v1/competitions/${competitionId}/referee-recruitment`).expect(404);

    // Одобрение: судья — в персонале турнира в роли должности.
    const r2 = await referee();
    await send(r2.session, 'post', `/api/v1/referee-recruitment/${positions[1]!.id}/applications`).expect(
      201,
    );
    const before = (
      await organizer.agent.get(`/api/v1/competitions/${competitionId}/referee-recruitment`).expect(200)
    ).body.data as Position[];
    const a1 = before[0]!.applications[0]!;
    expect(a1.applicant.id).toBe(r1.id);
    const approved = await send(
      organizer,
      'post',
      `/api/v1/competitions/${competitionId}/referee-recruitment/applications/${a1.id}/decision`,
      { decision: 'APPROVE' },
      a1.version,
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((approved.body.data as Position[])[0]!.applications[0]!.status).toBe('APPROVED');
    const staff = await t.admin.competitionMembership.findMany({
      where: { competitionId, userId: r1.id },
      include: { role: true },
    });
    expect(staff.map((s) => [s.role.code, s.status])).toEqual([['REFEREE', 'ACTIVE']]);
    // Решение принимается один раз.
    const again = await send(
      organizer,
      'post',
      `/api/v1/competitions/${competitionId}/referee-recruitment/applications/${a1.id}/decision`,
      { decision: 'REJECT' },
      a1.version + 1,
    );
    expect(again.status).toBe(422);

    // Отклонение: роли в турнире нет.
    const a2 = before[1]!.applications[0]!;
    await send(
      organizer,
      'post',
      `/api/v1/competitions/${competitionId}/referee-recruitment/applications/${a2.id}/decision`,
      { decision: 'REJECT' },
      a2.version,
    ).expect(200);
    expect(await t.admin.competitionMembership.count({ where: { competitionId, userId: r2.id } })).toBe(0);
    const mine = await r2.session.agent.get('/api/v1/referee-recruitment').expect(200);
    expect(mine.body.data[0].positions[1].myApplication).toMatchObject({ status: 'REJECTED' });
  });

  it('the organizer adds and closes positions; a closed position takes no applications', async () => {
    const competitionId = await createCompetition();
    await organizer.agent
      .get(`/api/v1/competitions/${competitionId}/referee-recruitment`)
      .expect(200, { data: [] });
    const bad = await send(organizer, 'post', `/api/v1/competitions/${competitionId}/referee-recruitment`, {
      roleCode: 'COACH',
      requirements: '',
    });
    expect(bad.status).toBe(400);
    const added = await send(organizer, 'post', `/api/v1/competitions/${competitionId}/referee-recruitment`, {
      roleCode: 'CHIEF_REFEREE',
      requirements: 'Всероссийская категория',
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const position = (added.body.data as Position[])[0]!;
    const closed = await send(
      organizer,
      'patch',
      `/api/v1/competitions/${competitionId}/referee-recruitment/${position.id}`,
      { status: 'CLOSED' },
      position.version,
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const r = await referee();
    const open = await r.session.agent.get('/api/v1/referee-recruitment').expect(200);
    expect(
      open.body.data.some((x: { competition: { id: string } }) => x.competition.id === competitionId),
    ).toBe(false);
    expect(
      (await send(r.session, 'post', `/api/v1/referee-recruitment/${position.id}/applications`)).status,
    ).toBe(422);
  });
});

describe('demo access', () => {
  it('opens the four platform roles for viewing and refuses any action with DEMO_READ_ONLY', async () => {
    const s = await csrfAgent(t);
    const res = await s.agent.post('/api/v1/auth/demo').set('x-csrf-token', s.csrf).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      demo: true,
      email: null,
      // Правки 28.10.2026: только руководитель, судья, тренер и спортсмен.
      availableRoles: ['ORGANIZATION_HEAD', 'REFEREE', 'COACH', 'ATHLETE'],
      grants: { platform: [], organizations: [], competitions: [] },
    });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('sde_csrf='));
    const demo: Session = { agent: s.agent, csrf: decodeURIComponent(cookie!.split(';')[0]!.slice(9)) };

    // Переключение роли — просмотр; чтение доступно.
    expect((await send(demo, 'put', '/api/v1/me/role', { role: 'ADMIN' })).status).toBe(403);
    const role = await send(demo, 'put', '/api/v1/me/role', { role: 'REFEREE' });
    expect(role.status, JSON.stringify(role.body)).toBe(200);
    expect(role.body.data.activeRole).toBe('REFEREE');
    await demo.agent.get('/api/v1/referee-recruitment').expect(200);
    await demo.agent.get('/api/v1/competitions').expect(200);

    // Любое действие — отказ.
    for (const [method, url, body] of [
      ['patch', '/api/v1/me', { displayName: 'Хакер' }],
      ['post', '/api/v1/competition-requests', {}],
      ['post', '/api/v1/auth/totp/setup', {}],
    ] as const) {
      const r = await send(demo, method, url, body);
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(r.body.error.code).toBe('DEMO_READ_ONLY');
    }
    const user = await t.admin.user.findFirstOrThrow({ where: { isDemo: true } });
    expect(user.displayName).toBe('Гость');

    // Сеансы других посетителей демо не видны.
    const other = await csrfAgent(t);
    await other.agent.post('/api/v1/auth/demo').set('x-csrf-token', other.csrf).send({}).expect(200);
    const sessions = await demo.agent.get('/api/v1/auth/sessions').expect(200);
    expect(sessions.body.data).toHaveLength(1);

    await send(demo, 'post', '/api/v1/auth/logout').expect(204);
  });
});
