// Integration: регистрация в системе по ролям (Phase 9a; API.md, 3.10) — руководитель организации, тренер (сам и через
// организацию), спортсмен (сам и через организацию и тренера), судья; одобрение, отказ, исправление; доступ к чужим
// заявкам, роль и статус из клиента, повторная отправка, недопустимый файл, присоединение позже, решение без прав.
import type { OnboardingRequestDto } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOrg,
  createUser,
  createTestApp,
  login,
  resetData,
  type Session,
  type TestApp,
} from './helpers/app';
import { givePerson, PDF, PNG, send, upload } from './helpers/phase3';

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

const YEAR = new Date().getUTCFullYear();
const BASE = '/api/v1/onboarding';

const adult = (over: Record<string, unknown> = {}) => ({
  lastName: 'Сидоров',
  firstName: 'Пётр',
  middleName: 'Иванович',
  birthDate: '1985-04-12',
  gender: 'MALE',
  phone: '+79991112233',
  contactEmail: 'petr@test.local',
  contactChannels: ['EMAIL', 'PHONE'],
  ...over,
});

const child = (over: Record<string, unknown> = {}) =>
  adult({
    lastName: 'Борцов',
    firstName: 'Илья',
    middleName: null,
    birthDate: `${YEAR - 12}-03-10`,
    ...over,
  });

const headOrganization = (over: Record<string, unknown> = {}) => ({
  name: 'Клуб самбо «Победа»',
  shortName: 'Победа',
  type: 'CLUB',
  legalForm: 'RU_LEGAL_ENTITY',
  countryCode: 'RU',
  inn: '7701234567',
  legalName: 'АНО «Клуб самбо Победа»',
  legalAddress: 'г. Москва, ул. Тестовая, д. 1',
  ...over,
});

async function applicant(): Promise<{ id: string; s: Session }> {
  const u = await createUser(t);
  return { id: u.id, s: await login(t, u.email) };
}

async function platformAdmin(): Promise<Session> {
  const u = await createUser(t, { platform: ['PLATFORM_ADMIN'] });
  return login(t, u.email, { totp: true });
}

async function clubWithManager(): Promise<{ clubId: string; manager: Session; managerId: string }> {
  const clubId = await createOrg(t, { type: 'CLUB' });
  const m = await createUser(t, { orgs: [{ organizationId: clubId, role: 'CLUB_MANAGER' }] });
  return { clubId, manager: await login(t, m.email), managerId: m.id };
}

/** Подтверждённый тренер клуба: учётная запись с ролью COACH, профиль и работа в клубе. */
async function clubCoach(clubId: string): Promise<{ coachId: string; s: Session; userId: string }> {
  const u = await createUser(t, { orgs: [{ organizationId: clubId, role: 'COACH' }] });
  const personId = await givePerson(t, u.id, {
    lastName: 'Тренеров',
    firstName: 'Олег',
    birthDate: '1979-02-02',
  });
  const coachId = uuidv7();
  await t.admin.coachProfile.create({ data: { id: coachId, personId } });
  await t.admin.coachMembership.create({
    data: { id: uuidv7(), coachId, organizationId: clubId, validFrom: new Date('2020-01-01T00:00:00Z') },
  });
  return { coachId, s: await login(t, u.email), userId: u.id };
}

async function draft(s: Session, body: Record<string, unknown>): Promise<OnboardingRequestDto> {
  const res = await send(s, 'post', `${BASE}/requests`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as OnboardingRequestDto;
}

async function attach(s: Session, r: OnboardingRequestDto, typeCode: string): Promise<OnboardingRequestDto> {
  const fileId = await upload(t, s, 'ONBOARDING_DOCUMENT', PDF, 'application/pdf', `${typeCode}.pdf`);
  const res = await send(s, 'post', `${BASE}/requests/${r.id}/documents`, { typeCode, fileId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as OnboardingRequestDto;
}

const submit = (s: Session, r: OnboardingRequestDto) =>
  send(s, 'post', `${BASE}/requests/${r.id}/submit`, { consentPersonalData: true }, r.version);

const decide = (
  s: Session,
  r: OnboardingRequestDto,
  action: 'approve' | 'reject' | 'request-changes',
  body: Record<string, unknown> = {},
) => send(s, 'post', `${BASE}/requests/${r.id}/${action}`, body, r.version);

async function submitted(s: Session, r: OnboardingRequestDto): Promise<OnboardingRequestDto> {
  const res = await submit(s, r);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as OnboardingRequestDto;
}

async function reviewed(s: Session, id: string): Promise<OnboardingRequestDto> {
  const res = await s.agent.get(`${BASE}/requests/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as OnboardingRequestDto;
}

const personOf = async (userId: string) =>
  (await t.admin.user.findUniqueOrThrow({ where: { id: userId }, select: { personId: true } })).personId;

describe('1. руководитель спортивной организации', () => {
  it('регистрирует организацию: документы обязательны, полномочия — только после одобрения платформой', async () => {
    const a = await applicant();
    let r = await draft(a.s, { role: 'ORGANIZATION_HEAD', ...adult(), organization: headOrganization() });
    expect(r.status).toBe('DRAFT');
    expect(r.documentRules.map((x) => x.typeCodes[0])).toEqual(['PASSPORT', 'EGRUL_EXTRACT', 'OTHER']);

    const incomplete = await submit(a.s, r);
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual([
      'documents.PASSPORT',
      'documents.EGRUL_EXTRACT',
    ]);

    r = await attach(a.s, r, 'PASSPORT');
    r = await attach(a.s, r, 'EGRUL_EXTRACT');
    const noConsent = await send(a.s, 'post', `${BASE}/requests/${r.id}/submit`, {}, r.version);
    expect(noConsent.status).toBe(400);
    r = await submitted(a.s, r);
    expect(r.status).toBe('PENDING_REVIEW');
    expect(r.allowedActions).toEqual(['cancel']);
    expect(await t.admin.organizationMembership.count({ where: { userId: a.id } })).toBe(0);

    const pa = await platformAdmin();
    const queue = await pa.agent.get(`${BASE}/review`).query({ role: 'ORGANIZATION_HEAD' });
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((x: OnboardingRequestDto) => x.id)).toEqual([r.id]);
    expect(queue.body.data[0].applicant.userId).toBe(a.id);

    const forReview = await reviewed(pa, r.id);
    expect(forReview.allowedActions).toEqual(['approve', 'reject', 'request_changes']);
    const approved = await decide(pa, forReview, 'approve', { comment: 'Документы в порядке' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const done = approved.body.data as OnboardingRequestDto;
    expect(done.status).toBe('APPROVED');
    expect(done.resultOrganizationId).toBeTruthy();

    const org = await t.admin.organization.findUniqueOrThrow({
      where: { id: done.resultOrganizationId ?? '' },
      include: { legalDetails: true, memberships: { include: { role: true } } },
    });
    expect(org.status).toBe('ACTIVE');
    expect(org.legalDetails?.inn).toBe('7701234567');
    expect(org.memberships.map((m) => [m.userId, m.role.code, m.status])).toEqual([
      [a.id, 'CLUB_MANAGER', 'ACTIVE'],
    ]);
    expect(await personOf(a.id)).toBeTruthy();

    const history = await a.s.agent.get(`${BASE}/requests/${r.id}/history`);
    expect(history.body.data.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'APPROVED',
    ]);
    const events = await t.admin.outboxEvent.findMany({
      where: { aggregateId: r.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['onboarding.submitted', 'onboarding.decided']);

    // Та же организация второй раз не регистрируется (ИНН).
    const b = await applicant();
    let dup = await draft(b.s, {
      role: 'ORGANIZATION_HEAD',
      ...adult({ lastName: 'Другой' }),
      organization: headOrganization({ name: 'Иное название' }),
    });
    dup = await attach(b.s, dup, 'PASSPORT');
    dup = await attach(b.s, dup, 'EGRUL_EXTRACT');
    const clash = await submit(b.s, dup);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('ORGANIZATION_ALREADY_REGISTERED');
  });

  it('иностранной организации выписка ЕГРЮЛ не нужна', async () => {
    const a = await applicant();
    let r = await draft(a.s, {
      role: 'ORGANIZATION_HEAD',
      ...adult(),
      organization: headOrganization({
        legalForm: 'FOREIGN',
        countryCode: 'KZ',
        inn: '7701234567',
        name: 'Sambo club Almaty',
      }),
    });
    expect(r.newOrganization?.inn).toBeNull();
    r = await attach(a.s, r, 'PASSPORT');
    expect((await submitted(a.s, r)).status).toBe('PENDING_REVIEW');
  });
});

describe('2–3. тренер', () => {
  it('независимый тренер: квалификация требует документа, после одобрения — профиль без организации', async () => {
    const a = await applicant();
    let r = await draft(a.s, {
      role: 'COACH',
      ...adult(),
      inOrganization: false,
      coachQualification: 'Первая квалификационная категория',
    });
    r = await attach(a.s, r, 'PASSPORT');
    const missing = await submit(a.s, r);
    expect(missing.body.error.details.fields).toEqual([
      { path: 'documents.COACH_QUALIFICATION', code: 'document_required' },
    ]);
    r = await attach(a.s, r, 'COACH_QUALIFICATION');
    r = await submitted(a.s, r);
    expect(r.status).toBe('PENDING_REVIEW');

    const pa = await platformAdmin();
    expect((await decide(pa, await reviewed(pa, r.id), 'approve')).status).toBe(200);
    const personId = await personOf(a.id);
    const coach = await t.admin.coachProfile.findUniqueOrThrow({
      where: { personId: personId ?? '' },
      include: { memberships: true },
    });
    expect(coach.memberships).toHaveLength(0);
  });

  it('тренер организации: заявку рассматривает руководитель, после одобрения — членство и роль «Тренер»', async () => {
    const { clubId, manager } = await clubWithManager();
    const a = await applicant();
    const orgs = await a.s.agent.get(`${BASE}/organizations`);
    expect(orgs.body.data.map((o: { id: string }) => o.id)).toContain(clubId);

    let r = await draft(a.s, { role: 'COACH', ...adult(), inOrganization: true, organizationId: clubId });
    r = await attach(a.s, r, 'PASSPORT');
    r = await submitted(a.s, r);
    expect(r.status).toBe('PENDING_ORGANIZATION_APPROVAL');
    expect(r.organization?.id).toBe(clubId);
    // До одобрения — ни членства, ни профиля.
    expect(await t.admin.organizationMembership.count({ where: { userId: a.id } })).toBe(0);

    // Платформа видит заявку, но очередь руководителя — его клуб.
    const queue = await manager.agent.get(`${BASE}/review`);
    expect(queue.body.data.map((x: OnboardingRequestDto) => x.id)).toEqual([r.id]);
    const ok = await decide(manager, await reviewed(manager, r.id), 'approve');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const membership = await t.admin.organizationMembership.findFirstOrThrow({
      where: { userId: a.id, organizationId: clubId },
      include: { role: true },
    });
    expect([membership.role.code, membership.status]).toEqual(['COACH', 'ACTIVE']);
    const coach = await t.admin.coachProfile.findUniqueOrThrow({
      where: { personId: (await personOf(a.id)) ?? '' },
      include: { memberships: true },
    });
    expect(coach.memberships.map((m) => [m.organizationId, m.validTo])).toEqual([[clubId, null]]);
  });
});

describe('4–5. спортсмен', () => {
  it('независимый спортсмен: без документов тренера, проверка платформой', async () => {
    const a = await applicant();
    let r = await draft(a.s, {
      role: 'ATHLETE',
      ...child(),
      inOrganization: false,
      coachQualification: 'КМС',
    });
    expect(r.coachQualification).toBeNull();
    expect(r.documentRules).toEqual([
      { role: 'ATHLETE', typeCodes: ['PASSPORT', 'BIRTH_CERTIFICATE'], required: false },
      { role: 'ATHLETE', typeCodes: ['OTHER'], required: false },
    ]);
    const wrongType = await send(a.s, 'post', `${BASE}/requests/${r.id}/documents`, {
      typeCode: 'COACH_QUALIFICATION',
      fileId: await upload(t, a.s, 'ONBOARDING_DOCUMENT', PDF, 'application/pdf'),
    });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.details.fields).toEqual([{ path: 'typeCode', code: 'not_allowed' }]);
    r = await submitted(a.s, r);
    expect(r.status).toBe('PENDING_REVIEW');
    const pa = await platformAdmin();
    expect((await decide(pa, await reviewed(pa, r.id), 'approve')).status).toBe(200);
    const athlete = await t.admin.athleteProfile.findUniqueOrThrow({
      where: { personId: (await personOf(a.id)) ?? '' },
      include: { memberships: true, coaches: true },
    });
    expect([athlete.memberships.length, athlete.coaches.length]).toEqual([0, 0]);
  });

  it('спортсмен клуба: выбирает тренера клуба; решает тренер, которому руководитель дал это право', async () => {
    const { clubId, manager } = await clubWithManager();
    const coach = await clubCoach(clubId);
    const other = await clubCoach(clubId);
    const a = await applicant();

    const options = await a.s.agent.get(`${BASE}/organizations/${clubId}/coaches`);
    expect(options.status).toBe(200);
    expect(options.body.data.map((c: { id: string }) => c.id).sort()).toEqual(
      [coach.coachId, other.coachId].sort(),
    );
    const foreignCoach = await draft(a.s, {
      role: 'ATHLETE',
      ...child(),
      inOrganization: true,
      organizationId: clubId,
    });
    const badCoach = await send(
      a.s,
      'patch',
      `${BASE}/requests/${foreignCoach.id}`,
      { coachId: uuidv7() },
      foreignCoach.version,
    );
    expect(badCoach.body.error.details.fields).toEqual([{ path: 'coachId', code: 'not_found' }]);

    let r = (
      await send(
        a.s,
        'patch',
        `${BASE}/requests/${foreignCoach.id}`,
        { coachId: coach.coachId },
        foreignCoach.version,
      )
    ).body.data as OnboardingRequestDto;
    r = await submitted(a.s, r);
    expect(r.status).toBe('PENDING_ORGANIZATION_APPROVAL');
    expect(r.coach?.id).toBe(coach.coachId);

    // Без назначенного права тренер заявки не видит и не решает.
    expect((await coach.s.agent.get(`${BASE}/review`)).status).toBe(403);
    expect((await decide(coach.s, r, 'approve')).status).toBe(404);
    const grant = await send(
      manager,
      'put',
      `/api/v1/organizations/${clubId}/coaches/${coach.coachId}/athlete-review`,
      {
        enabled: true,
      },
    );
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    expect(grant.body.data.organizations[0].canReviewAthletes).toBe(true);
    // Другой тренер того же клуба с правом не видит чужих спортсменов.
    await send(manager, 'put', `/api/v1/organizations/${clubId}/coaches/${other.coachId}/athlete-review`, {
      enabled: true,
    });
    expect((await other.s.agent.get(`${BASE}/review`)).body.data).toEqual([]);
    expect((await decide(other.s, r, 'approve')).status).toBe(404);

    const coachQueue = await coach.s.agent.get(`${BASE}/review`);
    expect(coachQueue.body.data.map((x: OnboardingRequestDto) => x.id)).toEqual([r.id]);
    const approved = await decide(coach.s, await reviewed(coach.s, r.id), 'approve');
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    const athlete = await t.admin.athleteProfile.findUniqueOrThrow({
      where: { personId: (await personOf(a.id)) ?? '' },
      include: { memberships: true, coaches: true },
    });
    expect(athlete.memberships.map((m) => [m.organizationId, m.isPrimary, m.validTo])).toEqual([
      [clubId, true, null],
    ]);
    expect(athlete.coaches.map((c) => [c.coachId, c.isPrimary])).toEqual([[coach.coachId, true]]);
  });

  it('тренер больше не работает в клубе — заявку нельзя одобрить с ним', async () => {
    const { clubId, manager } = await clubWithManager();
    const coach = await clubCoach(clubId);
    const a = await applicant();
    let r = await draft(a.s, {
      role: 'ATHLETE',
      ...child(),
      inOrganization: true,
      organizationId: clubId,
      coachId: coach.coachId,
    });
    r = await submitted(a.s, r);
    await t.admin.coachMembership.updateMany({
      where: { coachId: coach.coachId },
      data: { validTo: new Date(`${YEAR - 1}-01-01T00:00:00Z`) },
    });
    const res = await decide(manager, await reviewed(manager, r.id), 'approve');
    expect(res.status).toBe(422);
    expect(res.body.error.details.failed).toEqual(['coach_not_available']);
  });
});

describe('6. судья', () => {
  it('категория и судейская книжка; после одобрения — профиль судьи с категорией', async () => {
    const a = await applicant();
    let r = await draft(a.s, {
      role: 'REFEREE',
      ...adult(),
      refereeCategoryCode: 'CAT_1',
      inOrganization: true,
    });
    expect(r.inOrganization).toBeNull();
    r = await attach(a.s, r, 'PASSPORT');
    r = await attach(a.s, r, 'REFEREE_BOOK');
    r = await submitted(a.s, r);
    const pa = await platformAdmin();
    const forReview = await reviewed(pa, r.id);
    expect(forReview.documents.map((d) => d.typeCode)).toEqual(['PASSPORT', 'REFEREE_BOOK']);
    const url = await pa.agent.get(
      `${BASE}/requests/${r.id}/documents/${forReview.documents[0]?.id}/download-url`,
    );
    expect(url.status).toBe(200);
    expect(
      await t.admin.dataAccessLog.count({
        where: { resourceType: 'OnboardingDocument', action: 'DOWNLOAD' },
      }),
    ).toBe(1);
    expect((await decide(pa, forReview, 'approve')).status).toBe(200);
    const referee = await t.admin.refereeProfile.findUniqueOrThrow({
      where: { personId: (await personOf(a.id)) ?? '' },
    });
    expect(referee.refereeCategoryCode).toBe('CAT_1');
  });
});

describe('7–8. отказ и исправление', () => {
  it('отказ — с причиной, которую видит заявитель', async () => {
    const a = await applicant();
    const r = await submitted(a.s, await draft(a.s, { role: 'ATHLETE', ...child(), inOrganization: false }));
    const pa = await platformAdmin();
    const forReview = await reviewed(pa, r.id);
    expect((await decide(pa, forReview, 'reject')).status).toBe(400);
    const rejected = await decide(pa, forReview, 'reject', { reason: 'Данные не подтверждены' });
    expect(rejected.status).toBe(200);
    const mine = await reviewed(a.s, r.id);
    expect([mine.status, mine.decisionReason, mine.allowedActions]).toEqual([
      'REJECTED',
      'Данные не подтверждены',
      [],
    ]);
    expect(await t.admin.athleteProfile.count()).toBe(0);
  });

  it('возврат на исправление: заявитель меняет одно поле, остальное сохраняется, и отправляет снова', async () => {
    const a = await applicant();
    const r = await submitted(a.s, await draft(a.s, { role: 'ATHLETE', ...child(), inOrganization: false }));
    const pa = await platformAdmin();
    const back = await decide(pa, await reviewed(pa, r.id), 'request-changes', {
      reason: 'Уточните телефон',
    });
    expect(back.status).toBe(200);
    let mine = await reviewed(a.s, r.id);
    expect([mine.status, mine.decisionReason]).toEqual(['CHANGES_REQUESTED', 'Уточните телефон']);
    expect(mine.allowedActions).toEqual(['update', 'submit', 'cancel']);
    mine = (await send(a.s, 'patch', `${BASE}/requests/${r.id}`, { phone: '+79994445566' }, mine.version))
      .body.data as OnboardingRequestDto;
    expect([mine.phone, mine.lastName, mine.birthDate]).toEqual([
      '+79994445566',
      'Борцов',
      `${YEAR - 12}-03-10`,
    ]);
    mine = await submitted(a.s, mine);
    expect(mine.status).toBe('PENDING_REVIEW');
    const history = (await a.s.agent.get(`${BASE}/requests/${r.id}/history`)).body.data;
    expect(history.map((h: { toStatus: string; reason: string | null }) => [h.toStatus, h.reason])).toEqual([
      ['DRAFT', null],
      ['PENDING_REVIEW', null],
      ['CHANGES_REQUESTED', 'Уточните телефон'],
      ['PENDING_REVIEW', null],
    ]);
  });
});

describe('9–12. безопасность', () => {
  it('чужая заявка и её документы недоступны; черновик не виден проверяющим', async () => {
    const a = await applicant();
    let r = await draft(a.s, { role: 'REFEREE', ...adult(), refereeCategoryCode: 'CAT_2' });
    r = await attach(a.s, r, 'PASSPORT');
    const docId = r.documents[0]?.id;
    const stranger = await applicant();
    expect((await stranger.s.agent.get(`${BASE}/requests/${r.id}`)).status).toBe(404);
    expect(
      (await stranger.s.agent.get(`${BASE}/requests/${r.id}/documents/${docId}/download-url`)).status,
    ).toBe(404);
    expect(
      (await send(stranger.s, 'patch', `${BASE}/requests/${r.id}`, { phone: '+79990000000' }, r.version))
        .status,
    ).toBe(404);
    const file = await t.admin.onboardingDocument.findUniqueOrThrow({ where: { id: docId ?? '' } });
    expect((await stranger.s.agent.get(`/api/v1/files/${file.fileId}/download-url`)).status).toBe(404);
    const pa = await platformAdmin();
    expect((await pa.agent.get(`${BASE}/requests/${r.id}`)).status).toBe(404);
    const { manager } = await clubWithManager();
    expect((await manager.agent.get(`${BASE}/requests/${r.id}`)).status).toBe(404);
  });

  it('роль, статус и заявителя из клиента изменить нельзя; свою заявку не одобрить', async () => {
    const a = await applicant();
    const other = await applicant();
    const r = await draft(a.s, { role: 'ATHLETE', ...child(), inOrganization: false });
    const sneaky = await send(
      a.s,
      'patch',
      `${BASE}/requests/${r.id}`,
      { status: 'APPROVED', role: 'REFEREE', userId: other.id, kind: 'JOIN_ORGANIZATION' },
      r.version,
    );
    expect(sneaky.status).toBe(200);
    const row = await t.admin.onboardingRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect([row.status, row.role, row.userId, row.kind]).toEqual(['DRAFT', 'ATHLETE', a.id, 'REGISTRATION']);
    const own = await submitted(a.s, sneaky.body.data as OnboardingRequestDto);
    expect((await decide(a.s, own, 'approve')).status).toBe(403);
    // Платформенная роль из обычной регистрации не получается: прав проверки у заявителя нет.
    expect((await a.s.agent.get(`${BASE}/review`)).status).toBe(403);
  });

  it('повторная отправка и второй черновик той же роли отклоняются', async () => {
    const a = await applicant();
    const r = await draft(a.s, { role: 'ATHLETE', ...child(), inOrganization: false });
    expect((await submit(a.s, r)).status).toBe(200);
    const again = await submit(a.s, r);
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    const second = await send(a.s, 'post', `${BASE}/requests`, { role: 'ATHLETE' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_EXISTS');
    // Другая роль — можно (например, ещё и судья).
    expect((await send(a.s, 'post', `${BASE}/requests`, { role: 'REFEREE' })).status).toBe(201);
  });

  it('недопустимый файл не загружается и не прикрепляется', async () => {
    const a = await applicant();
    const r = await draft(a.s, { role: 'REFEREE', ...adult(), refereeCategoryCode: 'CAT_2' });
    const gif = await send(a.s, 'post', '/api/v1/files/uploads', {
      purpose: 'ONBOARDING_DOCUMENT',
      fileName: 'x.gif',
      mimeType: 'image/gif',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    });
    expect(gif.status).toBe(400);
    expect(gif.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const big = await send(a.s, 'post', '/api/v1/files/uploads', {
      purpose: 'ONBOARDING_DOCUMENT',
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 50 * 1024 * 1024,
      sha256: 'a'.repeat(64),
    });
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');
    // PNG под видом PDF: содержимое не совпадает с типом.
    await expect(upload(t, a.s, 'ONBOARDING_DOCUMENT', PNG, 'application/pdf')).rejects.toThrow(
      /FILE_CONTENT_MISMATCH/,
    );
    // Файл другой цели к заявке не прикрепляется.
    const logo = await upload(t, a.s, 'ORGANIZATION_LOGO', PNG, 'image/png', 'logo.png');
    const wrong = await send(a.s, 'post', `${BASE}/requests/${r.id}/documents`, {
      typeCode: 'PASSPORT',
      fileId: logo,
    });
    expect(wrong.body.error.details.fields).toEqual([{ path: 'fileId', code: 'invalid_file' }]);
  });
});

describe('13–14. присоединение позже и решение без прав', () => {
  it('независимый спортсмен присоединяется к клубу и тренеру без новой учётной записи', async () => {
    const { clubId, manager } = await clubWithManager();
    const coach = await clubCoach(clubId);
    const a = await applicant();
    const first = await submitted(
      a.s,
      await draft(a.s, { role: 'ATHLETE', ...child(), inOrganization: false }),
    );
    const pa = await platformAdmin();
    await decide(pa, await reviewed(pa, first.id), 'approve');

    // Вторая первичная регистрация не нужна — профиль уже есть.
    const again = await send(a.s, 'post', `${BASE}/requests`, { role: 'ATHLETE', ...child() });
    expect([again.status, again.body.error.code]).toEqual([409, 'ALREADY_EXISTS']);

    let join = await draft(a.s, {
      role: 'ATHLETE',
      kind: 'JOIN_ORGANIZATION',
      organizationId: clubId,
      coachId: coach.coachId,
    });
    expect(join.inOrganization).toBe(true);
    // При присоединении документы можно приложить, но ни один не обязателен (0.13.0).
    expect(join.documentRules).toEqual([
      { role: 'ATHLETE', typeCodes: ['PASSPORT', 'BIRTH_CERTIFICATE'], required: false },
      { role: 'ATHLETE', typeCodes: ['OTHER'], required: false },
    ]);
    join = await submitted(a.s, join);
    expect(join.status).toBe('PENDING_ORGANIZATION_APPROVAL');
    expect((await decide(manager, await reviewed(manager, join.id), 'approve')).status).toBe(200);

    const athletes = await t.admin.athleteProfile.findMany({ include: { memberships: true, coaches: true } });
    expect(athletes).toHaveLength(1);
    expect(athletes[0]?.memberships.map((m) => m.organizationId)).toEqual([clubId]);
    expect(athletes[0]?.coaches.map((c) => c.coachId)).toEqual([coach.coachId]);
    expect(await t.admin.user.count({ where: { id: a.id } })).toBe(1);

    const overview = await a.s.agent.get(`${BASE}/me`);
    expect(overview.body.data.profiles.athleteId).toBe(athletes[0]?.id);
    expect(overview.body.data.requests.map((x: OnboardingRequestDto) => x.status)).toEqual([
      'APPROVED',
      'APPROVED',
    ]);
  });

  it('присоединение без зарегистрированного профиля невозможно', async () => {
    const { clubId } = await clubWithManager();
    const a = await applicant();
    const res = await send(a.s, 'post', `${BASE}/requests`, {
      role: 'COACH',
      kind: 'JOIN_ORGANIZATION',
      organizationId: clubId,
    });
    expect(res.body.error.details.fields).toEqual([{ path: 'kind', code: 'profile_required' }]);
  });

  it('одобрить заявку может только уполномоченный проверяющий', async () => {
    const { clubId } = await clubWithManager();
    const otherClub = await clubWithManager();
    const a = await applicant();
    let r = await draft(a.s, { role: 'COACH', ...adult(), inOrganization: true, organizationId: clubId });
    r = await attach(a.s, r, 'PASSPORT');
    r = await submitted(a.s, r);
    const stranger = await applicant();
    expect((await decide(stranger.s, r, 'approve')).status).toBe(404);
    expect((await decide(otherClub.manager, r, 'approve')).status).toBe(404);
    const coach = await clubCoach(clubId);
    expect((await decide(coach.s, r, 'approve')).status).toBe(404);

    // Заявку платформенной проверки не решает руководитель клуба.
    const b = await applicant();
    const platformOnly = await submitted(
      b.s,
      await draft(b.s, { role: 'ATHLETE', ...child(), inOrganization: false }),
    );
    expect((await decide(otherClub.manager, platformOnly, 'approve')).status).toBe(404);
    expect(await t.admin.onboardingRequest.count({ where: { status: 'APPROVED' } })).toBe(0);
  });

  it('заявка в приостановленную организацию не отправляется', async () => {
    const { clubId } = await clubWithManager();
    const a = await applicant();
    let r = await draft(a.s, { role: 'COACH', ...adult(), inOrganization: true, organizationId: clubId });
    r = await attach(a.s, r, 'PASSPORT');
    await t.admin.organization.update({ where: { id: clubId }, data: { status: 'SUSPENDED' } });
    const res = await submit(a.s, r);
    expect(res.body.error.details.fields).toEqual([{ path: 'organizationId', code: 'not_found' }]);
  });
});
