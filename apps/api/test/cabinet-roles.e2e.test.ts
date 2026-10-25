// Integration: роль в кабинете (0.13.0) — права действуют только для выбранной роли; выбор на сессию входа, роль по
// умолчанию, переключение, проверка при изменении прав; регистрация с ролью и повторное письмо подтверждения.
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOrg,
  createTestApp,
  createUser,
  csrfAgent,
  login,
  resetData,
  sentEmails,
  type Session,
  type TestApp,
  tokenFromUrl,
} from './helpers/app';
import { givePerson, send } from './helpers/phase3';
import { clubAthlete } from './helpers/phase4';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetData(t);
});

const me = async (s: Session) => (await s.agent.get('/api/v1/me').expect(200)).body.data;
const selectRole = (s: Session, role: string) => send(s, 'put', '/api/v1/me/role', { role });

/**
 * Руководитель и тренер клуба A и представитель ребёнка из клуба B: три роли кабинета у одного человека.
 * У тренера свой спортсмен в клубе A.
 */
async function multiRole() {
  const clubA = await createOrg(t);
  const clubB = await createOrg(t);
  const user = await createUser(t, {
    orgs: [
      { organizationId: clubA, role: 'CLUB_MANAGER' },
      { organizationId: clubA, role: 'COACH' },
    ],
  });
  const personId = await givePerson(t, user.id, {
    lastName: 'Петров',
    firstName: 'Олег',
    birthDate: '1980-02-02',
  });
  const coachId = uuidv7();
  await t.admin.coachProfile.create({ data: { id: coachId, personId } });
  await t.admin.coachMembership.create({
    data: { id: uuidv7(), coachId, organizationId: clubA, validFrom: new Date('2020-01-01T00:00:00Z') },
  });
  const pupil = await clubAthlete(t, { clubId: clubA, coachId });
  const child = await clubAthlete(t, { clubId: clubB, lastName: 'Петров' });
  await t.admin.guardian.create({
    data: {
      id: uuidv7(),
      athleteId: child.athleteId,
      guardianPersonId: personId,
      relation: 'FATHER',
      verifiedAt: new Date(),
      verificationBasis: 'DOCUMENT_SHOWN',
    },
  });
  return { clubA, clubB, user, pupil, child };
}

describe('роль в кабинете', () => {
  it('права действуют только в выбранной роли; переключение меняет доступ', async () => {
    const w = await multiRole();
    const s = await login(t, w.user.email);

    const first = await me(s);
    expect(first.availableRoles).toEqual(['ORGANIZATION_HEAD', 'COACH', 'GUARDIAN']);
    expect(first.activeRole).toBe('ORGANIZATION_HEAD');
    expect(first.grants.organizations).toEqual([{ organizationId: w.clubA, roles: ['CLUB_MANAGER'] }]);

    // Руководитель: спортсмены клуба видны, ребёнок из другого клуба — нет, «мои спортсмены» пусто.
    expect((await s.agent.get(`/api/v1/athletes/${w.pupil.athleteId}`)).status).toBe(200);
    expect((await s.agent.get(`/api/v1/athletes/${w.child.athleteId}`)).status).toBe(404);
    expect((await s.agent.get('/api/v1/me/athletes').expect(200)).body.data).toEqual([]);
    const mineAsHead = await s.agent.get(`/api/v1/athletes?organizationId=${w.clubA}&mine=true`).expect(200);
    expect(mineAsHead.body.data).toEqual([]);

    // Представитель: виден только ребёнок; права руководителя и тренера не действуют.
    const asGuardian = await selectRole(s, 'GUARDIAN');
    expect(asGuardian.status).toBe(200);
    expect(asGuardian.body.data.activeRole).toBe('GUARDIAN');
    expect(asGuardian.body.data.grants).toEqual({ platform: [], organizations: [], competitions: [] });
    expect((await s.agent.get(`/api/v1/athletes/${w.child.athleteId}`)).status).toBe(200);
    expect((await s.agent.get(`/api/v1/athletes/${w.pupil.athleteId}`)).status).toBe(404);
    const kids = (await s.agent.get('/api/v1/me/athletes').expect(200)).body.data;
    expect(kids.map((k: { athleteId: string }) => k.athleteId)).toEqual([w.child.athleteId]);
    expect((await s.agent.get(`/api/v1/organizations/${w.clubA}/members`)).status).toBe(403);

    // Тренер: свои спортсмены; ребёнок — нет.
    expect((await selectRole(s, 'COACH')).body.data.grants.organizations).toEqual([
      { organizationId: w.clubA, roles: ['COACH'] },
    ]);
    const mine = await s.agent.get(`/api/v1/athletes?organizationId=${w.clubA}&mine=true`).expect(200);
    expect(mine.body.data.map((a: { id: string }) => a.id)).toEqual([w.pupil.athleteId]);
    expect((await s.agent.get(`/api/v1/athletes/${w.child.athleteId}`)).status).toBe(404);

    // Роль, которой у пользователя нет, не выбрать; роль не из списка — ошибка проверки.
    const notHeld = await selectRole(s, 'ADMIN');
    expect(notHeld.status).toBe(403);
    expect(notHeld.body.error.details).toMatchObject({ reason: 'cabinet_role_not_held' });
    expect((await selectRole(s, 'SUPER_ADMIN')).status).toBe(400);
    expect((await me(s)).activeRole).toBe('COACH');
  });

  it('у каждой сессии своя роль; новая сессия начинается с последней выбранной', async () => {
    const w = await multiRole();
    const phone = await login(t, w.user.email);
    expect((await selectRole(phone, 'GUARDIAN')).status).toBe(200);

    const tablet = await login(t, w.user.email);
    expect((await me(tablet)).activeRole).toBe('GUARDIAN');
    expect((await selectRole(tablet, 'COACH')).status).toBe(200);

    expect((await me(phone)).activeRole).toBe('GUARDIAN');
    expect((await me(tablet)).activeRole).toBe('COACH');
  });

  it('при изменении прав выбор проверяется: роль остаётся, если она есть, иначе — роль по умолчанию', async () => {
    const club = await createOrg(t);
    const user = await createUser(t);
    const s = await login(t, user.email);
    expect(await me(s)).toMatchObject({ activeRole: null, availableRoles: [] });

    // Стал тренером клуба — сессия сразу в роли «Тренер», без перезахода.
    const coachRole = await t.admin.role.findUniqueOrThrow({ where: { code: 'COACH' } });
    const coachMembership = await t.admin.organizationMembership.create({
      data: {
        id: uuidv7(),
        organizationId: club,
        userId: user.id,
        roleId: coachRole.id,
        status: 'ACTIVE',
        validFrom: new Date(),
      },
    });
    await t.admin.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
    expect((await s.agent.get(`/api/v1/organizations/${club}/members`)).status).toBe(403);
    expect(await me(s)).toMatchObject({ activeRole: 'COACH', availableRoles: ['COACH'] });

    // Ещё и руководитель — выбранная роль «Тренер» остаётся.
    const managerRole = await t.admin.role.findUniqueOrThrow({ where: { code: 'CLUB_MANAGER' } });
    await t.admin.organizationMembership.create({
      data: {
        id: uuidv7(),
        organizationId: club,
        userId: user.id,
        roleId: managerRole.id,
        status: 'ACTIVE',
        validFrom: new Date(),
      },
    });
    await t.admin.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
    expect(await me(s)).toMatchObject({
      activeRole: 'COACH',
      availableRoles: ['ORGANIZATION_HEAD', 'COACH'],
    });
    expect((await s.agent.get(`/api/v1/organizations/${club}/members`)).status).toBe(403);

    // Тренером быть перестал — сессия переходит в оставшуюся роль.
    await t.admin.organizationMembership.update({
      where: { id: coachMembership.id },
      data: { status: 'ENDED' },
    });
    await t.admin.user.update({ where: { id: user.id }, data: { permissionsVersion: { increment: 1 } } });
    expect((await s.agent.get(`/api/v1/organizations/${club}/members`)).status).toBe(200);
    expect(await me(s)).toMatchObject({
      activeRole: 'ORGANIZATION_HEAD',
      availableRoles: ['ORGANIZATION_HEAD'],
    });
  });

  it('принял приглашение — сессия сразу в роли приглашения', async () => {
    const clubA = await createOrg(t);
    const clubB = await createOrg(t);
    const manager = await createUser(t, { orgs: [{ organizationId: clubB, role: 'CLUB_MANAGER' }] });
    const coach = await createUser(t, {
      email: 'coach-a@test.local',
      orgs: [{ organizationId: clubA, role: 'COACH' }],
    });
    const m = await login(t, manager.email);
    expect(
      (
        await send(m, 'post', `/api/v1/organizations/${clubB}/members`, {
          email: coach.email,
          roleCode: 'CLUB_MANAGER',
        })
      ).status,
    ).toBe(201);
    const [mail] = await sentEmails(t, 'organization.invite');
    const c = await login(t, coach.email);
    expect((await me(c)).activeRole).toBe('COACH');
    const accepted = await send(c, 'post', '/api/v1/invites/accept', {
      token: tokenFromUrl(mail?.params.acceptUrl),
    });
    expect(accepted.status).toBe(200);
    expect(await me(c)).toMatchObject({
      activeRole: 'ORGANIZATION_HEAD',
      availableRoles: ['ORGANIZATION_HEAD', 'COACH'],
      grants: { organizations: [{ organizationId: clubB, roles: ['CLUB_MANAGER'] }] },
    });
  });

  it('федерация создала турнир — сессия в роли «Судья», им можно управлять сразу; организатор остаётся', async () => {
    const start = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const body = (organizerOrganizationId: string) => ({
      name: 'Первенство федерации',
      organizerOrganizationId,
      level: 'REGIONAL',
      disciplineCode: 'SPORT_SAMBO',
      timezone: 'Europe/Moscow',
      startDate: start,
      endDate: start,
      registrationStartsAt: new Date(Date.now() - 86_400_000).toISOString(),
      registrationEndsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    });
    const fed = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
    const fa = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: fed, role: 'FEDERATION_ADMIN' }] })).email,
    );
    expect((await me(fa)).activeRole).toBe('ORGANIZATION_HEAD');
    const created = await send(fa, 'post', '/api/v1/competitions', body(fed));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.allowedActions).toContain('competition.update');
    expect(await me(fa)).toMatchObject({
      activeRole: 'REFEREE',
      availableRoles: ['ORGANIZATION_HEAD', 'REFEREE'],
    });
    const c = created.body.data as { id: string; version: number };
    expect(
      (await send(fa, 'patch', `/api/v1/competitions/${c.id}`, { name: 'Первенство' }, c.version)).status,
    ).toBe(200);

    // Организатор управляет турниром своей организации и в роли руководителя — роль не меняется.
    const org = await createOrg(t, { type: 'ORGANIZER' });
    const organizer = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: org, role: 'ORGANIZER' }] })).email,
    );
    const own = await send(organizer, 'post', '/api/v1/competitions', body(org));
    expect(own.status).toBe(201);
    expect(own.body.data.allowedActions).toContain('competition.update');
    expect((await me(organizer)).activeRole).toBe('ORGANIZATION_HEAD');
  });

  it('администратор платформы — только в роли «Администратор»', async () => {
    const club = await createOrg(t);
    const admin = await createUser(t, {
      platform: ['PLATFORM_ADMIN'],
      orgs: [{ organizationId: club, role: 'CLUB_MANAGER' }],
    });
    const s = await login(t, admin.email, { totp: true });
    expect(await me(s)).toMatchObject({
      activeRole: 'ADMIN',
      availableRoles: ['ADMIN', 'ORGANIZATION_HEAD'],
    });
    expect((await s.agent.get('/api/v1/admin/users')).status).toBe(200);

    expect((await selectRole(s, 'ORGANIZATION_HEAD')).status).toBe(200);
    expect((await s.agent.get('/api/v1/admin/users')).status).toBe(403);
    expect((await s.agent.get(`/api/v1/organizations/${club}/members`)).status).toBe(200);
  });
});

describe('куда уходят письма', () => {
  it('администратор видит, что письма не покидают сервер; без права — 403', async () => {
    const sa = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
    const status = await sa.agent.get('/api/v1/admin/settings/email-delivery').expect(200);
    expect(status.body.data).toMatchObject({ mode: 'LOG', internal: true, host: null });
    const pa = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, { totp: true });
    expect((await pa.agent.get('/api/v1/admin/settings/email-delivery')).status).toBe(403);
  });
});

describe('регистрация с ролью и повторное письмо', () => {
  const register = async (s: Session, email: string, role?: string) =>
    s.agent.post('/api/v1/auth/register').set('x-csrf-token', s.csrf).send({
      email,
      password: 'Lemon-Tatami-Throw-42',
      displayName: 'Новичок',
      locale: 'ru',
      acceptTerms: true,
      acceptPersonalData: true,
      role,
    });

  it('роль, выбранная до формы, запоминается; роль администратора выбрать нельзя', async () => {
    const s = await csrfAgent(t);
    expect((await register(s, 'admin-wannabe@test.local', 'ADMIN')).status).toBe(400);
    expect((await register(s, 'coach-new@test.local', 'COACH')).status).toBe(202);
    const [mail] = await sentEmails(t, 'auth.verify_email');
    const verified = await s.agent
      .post('/api/v1/auth/verify-email')
      .set('x-csrf-token', s.csrf)
      .send({ token: tokenFromUrl(mail?.params.verifyUrl) });
    expect(verified.status).toBe(200);
    // Роль ещё не выдана — только запомнена для анкеты.
    expect(verified.body.data).toMatchObject({
      preferredRole: 'COACH',
      activeRole: null,
      availableRoles: [],
    });
  });

  it('повторное письмо: прежняя ссылка действует до подтверждения, после — гаснут все; адрес не раскрывается', async () => {
    const s = await csrfAgent(t);
    expect((await register(s, 'slow@test.local', 'ATHLETE')).status).toBe(202);
    const resend = (email: string) =>
      s.agent
        .post('/api/v1/auth/verify-email/resend')
        .set('x-csrf-token', s.csrf)
        .send({ email, locale: 'ru' });
    const verify = (url: string | undefined) =>
      s.agent
        .post('/api/v1/auth/verify-email')
        .set('x-csrf-token', s.csrf)
        .send({ token: tokenFromUrl(url) });

    expect((await resend('slow@test.local')).status).toBe(202);
    const [old, fresh] = await sentEmails(t, 'auth.verify_email');
    expect(fresh?.to).toBe('slow@test.local');
    expect(fresh?.params.verifyUrl).not.toBe(old?.params.verifyUrl);

    // Нет такого адреса или он уже подтверждён — ответ тот же, письма нет.
    const active = await createUser(t);
    expect((await resend('nobody@test.local')).status).toBe(202);
    expect((await resend(active.email)).status).toBe(202);
    expect(await sentEmails(t, 'auth.verify_email')).toHaveLength(2);

    // Повторная отправка (в том числе посторонним) не гасит ссылку из первого письма.
    expect((await verify(old?.params.verifyUrl)).status).toBe(200);
    // Адрес подтверждён — ссылка из второго письма больше не действует (новый браузер: у первого — новая сессия).
    const other = await csrfAgent(t);
    const second = await other.agent
      .post('/api/v1/auth/verify-email')
      .set('x-csrf-token', other.csrf)
      .send({ token: tokenFromUrl(fresh?.params.verifyUrl) });
    expect(second.body.error.code).toBe('TOKEN_EXPIRED');
  });
});
