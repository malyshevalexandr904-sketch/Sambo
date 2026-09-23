// Integration: организации, иерархия, участники, приглашения (API.md, 3.4; PERMISSIONS.md).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOrg,
  createTestApp,
  createUser,
  login,
  resetData,
  sentEmails,
  type Session,
  type TestApp,
  tokenFromUrl,
} from './helpers/app';

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

const clubInput = (parentId?: string) => ({
  type: 'CLUB',
  name: 'Клуб самбо «Ёлочка»',
  shortName: 'Ёлочка',
  countryCode: 'ru',
  parentId,
  legalDetails: { legalName: 'АНО «Ёлочка»', inn: '7701234567', legalAddress: 'г. Учебный, ул. Тестовая, 1' },
});

async function post(s: Session, url: string, body: unknown, version?: number) {
  const r = s.agent.post(url).set('x-csrf-token', s.csrf);
  if (version !== undefined) r.set('if-match', `"v${version}"`);
  return r.send(body as object);
}

async function patch(s: Session, url: string, body: unknown, version?: number) {
  const r = s.agent.patch(url).set('x-csrf-token', s.csrf);
  if (version !== undefined) r.set('if-match', `"v${version}"`);
  return r.send(body as object);
}

describe('create and approve', () => {
  it('a user without rights files a club for review; the federation admin approves it', async () => {
    const fed = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
    const applicant = await createUser(t);
    const fa = await createUser(t, { orgs: [{ organizationId: fed, role: 'FEDERATION_ADMIN' }] });
    const a = await login(t, applicant.email);

    const created = await post(a, '/api/v1/organizations', clubInput(fed));
    expect(created.status).toBe(201);
    const club = created.body.data;
    expect(club.status).toBe('PENDING_REVIEW');
    expect(club.slug).toBe('elochka');
    expect(club.countryCode).toBe('RU');
    expect(club.legalDetails.inn).toBe('7701234567');
    expect(created.headers.etag).toBe('"v1"');

    // Создатель стал руководителем клуба, но не может сам себя одобрить.
    const me = await a.agent.get('/api/v1/me').expect(200);
    expect(me.body.data.grants.organizations).toEqual([{ organizationId: club.id, roles: ['CLUB_MANAGER'] }]);
    const selfApprove = await post(a, `/api/v1/organizations/${club.id}/transitions`, { to: 'ACTIVE' }, 1);
    expect(selfApprove.status).toBe(403);

    // Посторонний не видит организацию на проверке.
    const stranger = await login(t, (await createUser(t)).email);
    expect((await stranger.agent.get(`/api/v1/organizations/${club.id}`)).status).toBe(404);
    const strangerList = await stranger.agent.get('/api/v1/organizations').expect(200);
    expect(strangerList.body.data.map((o: { id: string }) => o.id)).not.toContain(club.id);

    const f = await login(t, fa.email);
    const withoutVersion = await post(f, `/api/v1/organizations/${club.id}/transitions`, { to: 'ACTIVE' });
    expect(withoutVersion.body.error.code).toBe('VERSION_REQUIRED');
    const approved = await post(f, `/api/v1/organizations/${club.id}/transitions`, { to: 'ACTIVE' }, 1);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('ACTIVE');

    const invalid = await post(f, `/api/v1/organizations/${club.id}/transitions`, { to: 'ACTIVE' }, 2);
    expect(invalid.body.error).toMatchObject({ code: 'INVALID_TRANSITION', details: { from: 'ACTIVE', allowed: ['SUSPENDED', 'ARCHIVED'] } });
    const noReason = await post(f, `/api/v1/organizations/${club.id}/transitions`, { to: 'SUSPENDED' }, 2);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');

    const audit = await t.admin.auditLog.findMany({ where: { entityId: club.id }, orderBy: { occurredAt: 'asc' } });
    expect(audit.map((x) => x.action)).toEqual(['organization.created', 'organization.status_changed']);
    expect(JSON.stringify(audit[0]?.after)).not.toContain('7701234567');
    const events = await t.admin.outboxEvent.findMany({ where: { aggregateId: club.id } });
    expect(events.map((e) => e.type).sort()).toEqual(['organization.created', 'organization.status_changed']);
  });

  it('federation admin creates an ACTIVE child directly and edits it; the club manager of a sibling cannot', async () => {
    const fed = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
    const sibling = await createOrg(t, { parentId: fed });
    const fa = await login(t, (await createUser(t, { orgs: [{ organizationId: fed, role: 'FEDERATION_ADMIN' }] })).email);
    const cm = await login(t, (await createUser(t, { orgs: [{ organizationId: sibling, role: 'CLUB_MANAGER' }] })).email);

    const created = await post(fa, '/api/v1/organizations', clubInput(fed));
    expect(created.body.data.status).toBe('ACTIVE');
    const id = created.body.data.id as string;

    const edited = await patch(fa, `/api/v1/organizations/${id}`, { city: 'Северогорск' }, 1);
    expect(edited.status).toBe(200);
    expect(edited.body.data.version).toBe(2);
    const stale = await patch(fa, `/api/v1/organizations/${id}`, { city: 'Другой' }, 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });

    expect((await patch(cm, `/api/v1/organizations/${id}`, { city: 'Взлом' }, 2)).status).toBe(403);
    // Реквизиты видны только тем, кто вправе менять организацию.
    const asCm = await cm.agent.get(`/api/v1/organizations/${id}`).expect(200);
    expect(asCm.body.data.legalDetails).toBeNull();
    expect(asCm.body.data.allowedActions).toEqual([]);
    const asFa = await fa.agent.get(`/api/v1/organizations/${id}`).expect(200);
    expect(asFa.body.data.legalDetails.inn).toBe('7701234567');
    expect(asFa.body.data.allowedActions).toEqual(expect.arrayContaining(['organization.update', 'organization.approve', 'transition:SUSPENDED']));
  });

  it('forbids hierarchy cycles and duplicate slugs', async () => {
    const root = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
    const child = await createOrg(t, { type: 'REGIONAL_FEDERATION', parentId: root });
    const sa = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
    const rootRow = await t.admin.organization.findUniqueOrThrow({ where: { id: root } });
    const cycle = await patch(sa, `/api/v1/organizations/${root}`, { parentId: child }, rootRow.version);
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe('ORGANIZATION_HIERARCHY_CYCLE');

    const childRow = await t.admin.organization.findUniqueOrThrow({ where: { id: child } });
    const dup = await patch(sa, `/api/v1/organizations/${child}`, { slug: rootRow.slug }, childRow.version);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SLUG_TAKEN');
  });

  it('moves a subtree and keeps the closure table consistent', async () => {
    const a = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
    const b = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
    const mid = await createOrg(t, { type: 'SPORTS_SCHOOL', parentId: a });
    const leaf = await createOrg(t, { parentId: mid });
    const sa = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
    await patch(sa, `/api/v1/organizations/${mid}`, { parentId: b }, 1).then((r) => expect(r.status).toBe(200));
    const rows = await t.admin.organizationClosure.findMany({ where: { descendantId: leaf }, orderBy: { depth: 'asc' } });
    expect(rows.map((r) => [r.ancestorId, r.depth])).toEqual([
      [leaf, 0],
      [mid, 1],
      [b, 2],
    ]);
  });
});

describe('members and invitations', () => {
  it('club manager invites a coach; only the invited email can accept', async () => {
    const club = await createOrg(t);
    const cm = await login(t, (await createUser(t, { orgs: [{ organizationId: club, role: 'CLUB_MANAGER' }] })).email);

    const invited = await post(cm, `/api/v1/organizations/${club}/members`, { email: 'Coach@Test.local', roleCode: 'COACH' });
    expect(invited.status).toBe(201);
    expect(invited.body.data).toMatchObject({ status: 'INVITED', roleCode: 'COACH', invitedEmail: 'coach@test.local' });
    const dup = await post(cm, `/api/v1/organizations/${club}/members`, { email: 'coach@test.local', roleCode: 'COACH' });
    expect(dup.body.error.code).toBe('ALREADY_EXISTS');

    const [mail] = await sentEmails(t, 'organization.invite');
    const token = tokenFromUrl(mail?.params.acceptUrl);

    const wrong = await login(t, (await createUser(t)).email);
    const wrongRes = await post(wrong, '/api/v1/invites/accept', { token });
    expect(wrongRes.status).toBe(403);

    // Токен погашен неудачной попыткой? Нет: транзакция откатилась, токен действует.
    const coach = await createUser(t, { email: 'coach@test.local' });
    const c = await login(t, coach.email);
    const accepted = await post(c, '/api/v1/invites/accept', { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ status: 'ACTIVE', user: { id: coach.id } });
    const me = await c.agent.get('/api/v1/me').expect(200);
    expect(me.body.data.grants.organizations).toEqual([{ organizationId: club, roles: ['COACH'] }]);

    const list = await cm.agent.get(`/api/v1/organizations/${club}/members`).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.page).toEqual({ nextCursor: null, hasMore: false });
    // Тренер не видит состав клуба.
    expect((await c.agent.get(`/api/v1/organizations/${club}/members`)).status).toBe(403);
  });

  it('cannot grant a role wider than your own; suspending a member removes rights immediately', async () => {
    const club = await createOrg(t);
    const cmUser = await createUser(t, { orgs: [{ organizationId: club, role: 'CLUB_MANAGER' }] });
    const cm = await login(t, cmUser.email);
    const wider = await post(cm, `/api/v1/organizations/${club}/members`, { email: 'x@test.local', roleCode: 'ORGANIZER' });
    expect(wider.status).toBe(422);
    expect(wider.body.error.code).toBe('ROLE_EXCEEDS_GRANTOR');
    const platformRole = await post(cm, `/api/v1/organizations/${club}/members`, { email: 'x@test.local', roleCode: 'SUPER_ADMIN' });
    expect(platformRole.body.error.code).toBe('VALIDATION_FAILED');

    const second = await createUser(t, { orgs: [{ organizationId: club, role: 'CLUB_MANAGER' }] });
    const s2 = await login(t, second.email);
    expect((await s2.agent.get(`/api/v1/organizations/${club}/members`)).status).toBe(200);
    const membership = await t.admin.organizationMembership.findFirstOrThrow({ where: { userId: second.id } });
    const suspended = await patch(cm, `/api/v1/organizations/${club}/members/${membership.id}`, { status: 'SUSPENDED' }, membership.version);
    expect(suspended.status).toBe(200);
    expect((await s2.agent.get(`/api/v1/organizations/${club}/members`)).status).toBe(403);
    const ended = await patch(cm, `/api/v1/organizations/${club}/members/${membership.id}`, { status: 'ENDED' }, membership.version + 1);
    expect(ended.status).toBe(200);
    const revive = await patch(cm, `/api/v1/organizations/${club}/members/${membership.id}`, { status: 'ACTIVE' }, membership.version + 2);
    expect(revive.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('list and search', () => {
  it('searches by name ignoring case and ё, with cursor pagination', async () => {
    const sa = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
    for (const name of ['Клуб «Ёрш»', 'Клуб «Ершов»', 'Спортшкола «Волна»']) {
      await post(sa, '/api/v1/organizations', { type: 'CLUB', name, shortName: name.slice(0, 20), countryCode: 'RU' });
    }
    const res = await sa.agent.get('/api/v1/organizations').query({ q: 'ерш', limit: 1 }).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.page.hasMore).toBe(true);
    const next = await sa.agent.get('/api/v1/organizations').query({ q: 'ерш', limit: 1, cursor: res.body.page.nextCursor }).expect(200);
    expect(next.body.data).toHaveLength(1);
    expect(next.body.page.hasMore).toBe(false);
    expect([res.body.data[0].name, next.body.data[0].name].sort()).toEqual(['Клуб «Ершов»', 'Клуб «Ёрш»'].sort());
    const bad = await sa.agent.get('/api/v1/organizations').query({ cursor: 'garbage' });
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });
});
