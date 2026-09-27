// Турнир (Phase 4a): создание, положение, публикация с закреплением правил, персонал, категории и их
// объединение, переходы турнира, публичная страница, право записи турнира и журнал синхронизации.
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrg,
  createTestApp,
  createUser,
  login,
  resetData,
  sentEmails,
  type Session,
  type TestApp,
} from './helpers/app';
import { PDF, send, upload } from './helpers/phase3';
import { categoryTemplate, isoDate, publishedRuleSet } from './helpers/phase4';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

const day = 24 * 60 * 60 * 1000;

interface World {
  organizerOrgId: string;
  organizer: Session;
  organizerUser: { id: string; email: string };
  ruleSetVersionId: string;
  templateId: string;
}

async function world(): Promise<World> {
  const organizerOrgId = await createOrg(t, { type: 'ORGANIZER' });
  const organizerUser = await createUser(t, {
    orgs: [{ organizationId: organizerOrgId, role: 'ORGANIZER' }],
  });
  const organizer = await login(t, organizerUser.email);
  const ruleSetVersionId = await publishedRuleSet(t);
  const { templateId } = await categoryTemplate(t);
  return { organizerOrgId, organizer, organizerUser, ruleSetVersionId, templateId };
}

const schedule = (startInDays = 30) => {
  const start = new Date(Date.now() + startInDays * day);
  return {
    timezone: 'Europe/Moscow',
    startDate: isoDate(start),
    endDate: isoDate(start),
    registrationStartsAt: new Date(Date.now() - day).toISOString(),
    registrationEndsAt: new Date(Date.now() + (startInDays - 10) * day).toISOString(),
  };
};

async function draft(w: World, over: Record<string, unknown> = {}) {
  const res = await send(w.organizer, 'post', '/api/v1/competitions', {
    name: 'Открытое первенство клуба',
    organizerOrganizationId: w.organizerOrgId,
    level: 'CLUB',
    disciplineCode: 'SPORT_SAMBO',
    ...schedule(),
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as {
    id: string;
    slug: string;
    version: number;
    status: string;
    allowedActions: string[];
  };
}

async function publish(w: World): Promise<{ id: string; slug: string; version: number }> {
  const c = await draft(w, { ruleSetVersionId: w.ruleSetVersionId });
  await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/categories/generate`, {
    templateId: w.templateId,
  }).expect(201);
  const current = await w.organizer.agent.get(`/api/v1/competitions/${c.id}`).expect(200);
  const res = await send(
    w.organizer,
    'post',
    `/api/v1/competitions/${c.id}/transitions`,
    { to: 'REGISTRATION_OPEN' },
    current.body.data.version,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

describe('competition lifecycle', () => {
  it('an organizer creates a draft and becomes its tournament manager; schedule is validated in its timezone', async () => {
    const w = await world();
    const c = await draft(w);
    expect(c.status).toBe('DRAFT');
    expect(c.slug).toMatch(/^otkrytoe-pervenstvo-kluba-\d{4}$/);
    expect(c.allowedActions).toEqual(
      expect.arrayContaining(['competition.update', 'transition:REGISTRATION_OPEN']),
    );
    const staff = await w.organizer.agent.get(`/api/v1/competitions/${c.id}/members`).expect(200);
    expect(staff.body.data.map((m: { roleCode: string }) => m.roleCode)).toEqual(['TOURNAMENT_MANAGER']);
    const lease = await t.admin.competitionWriteLease.findUniqueOrThrow({ where: { competitionId: c.id } });
    expect(lease).toMatchObject({ holderType: 'CLOUD', epoch: 1 });

    // 23:30 по Москве в день начала — уже следующая дата по UTC? Нет: 20:30Z того же дня; а 00:30 по Москве
    // следующего дня (21:30Z дня начала) — позже даты начала в timezone турнира.
    const s = schedule();
    const lateInMoscow = new Date(`${s.startDate}T21:30:00Z`).toISOString();
    const bad = await send(w.organizer, 'post', '/api/v1/competitions', {
      name: 'Турнир с ошибкой',
      organizerOrganizationId: w.organizerOrgId,
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
      ...s,
      registrationEndsAt: lateInMoscow,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toEqual([
      { path: 'registrationEndsAt', code: 'registration_after_start' },
    ]);

    // Черновик не виден тем, у кого нет прав на турнир.
    const stranger = await createUser(t);
    const s2 = await login(t, stranger.email);
    await s2.agent.get(`/api/v1/competitions/${c.id}`).expect(404);
    const list = await s2.agent.get('/api/v1/competitions').expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(c.id);
  });

  it('a coach without competition.create cannot create a competition for an organization', async () => {
    const w = await world();
    const clubId = await createOrg(t);
    const coach = await createUser(t, { orgs: [{ organizationId: clubId, role: 'COACH' }] });
    const s = await login(t, coach.email);
    const res = await send(s, 'post', '/api/v1/competitions', {
      name: 'Самодеятельный турнир',
      organizerOrganizationId: clubId,
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
      ...schedule(),
    });
    expect(res.status).toBe(403);
    void w;
  });

  it('publication pins a published rule set version and needs categories; afterwards rules and discipline are frozen', async () => {
    const w = await world();
    const c = await draft(w);
    const noRules = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'REGISTRATION_OPEN' },
      c.version,
    );
    expect(noRules.body.error.code).toBe('RULESET_REQUIRED');

    const withRules = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}`,
      { ruleSetVersionId: w.ruleSetVersionId },
      c.version,
    );
    expect(withRules.status, JSON.stringify(withRules.body)).toBe(200);
    const noCategories = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'REGISTRATION_OPEN' },
      withRules.body.data.version,
    );
    expect(noCategories.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['no_categories'] },
    });

    const generated = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/categories/generate`, {
      templateId: w.templateId,
    });
    expect(generated.status).toBe(201);
    expect(generated.body.data.map((x: { code: string }) => x.code.replace(/-Y[0-9A-Z]+-/, '-*-'))).toEqual([
      'M-*-35',
      'M-*-38',
      'M-*-38+',
      'F-*-34',
    ]);
    const heavy = generated.body.data.find((x: { code: string }) => x.code.endsWith('38+'));
    expect(heavy.name.ru).toMatch(/^Юноши 12–13 лет, свыше 38 кг$/);
    expect(heavy.weight).toEqual({ kind: 'ABOVE', lowerGrams: 38000, upperGrams: null });
    const year = Number(schedule().startDate.slice(0, 4));
    expect(heavy.age).toMatchObject({
      policy: 'BY_BIRTH_YEAR',
      birthYearFrom: year - 13,
      birthYearTo: year - 12,
    });

    const pdf = await upload(t, w.organizer, 'REGULATION', PDF, 'application/pdf', 'polozhenie.pdf');
    const reg = await send(
      w.organizer,
      'put',
      `/api/v1/competitions/${c.id}/regulation`,
      { regulationFileId: pdf, requirementsMd: 'Медицинский допуск обязателен.' },
      withRules.body.data.version,
    );
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    expect(reg.body.data.regulation).toMatchObject({ fileId: pdf, fileName: 'polozhenie.pdf' });
    await send(w.organizer, 'put', `/api/v1/competitions/${c.id}/requirements`, {
      requirements: [
        { kind: 'DOCUMENT', documentTypeCode: 'MEDICAL_CERTIFICATE' },
        { kind: 'CONSENT', consentKind: 'PD_PROCESSING' },
        { kind: 'WEIGH_IN' },
      ],
    }).expect(200);

    const published = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'REGISTRATION_OPEN' },
      reg.body.data.version,
    );
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.data).toMatchObject({
      status: 'REGISTRATION_OPEN',
      registrationOpenNow: true,
      ruleSetVersion: { id: w.ruleSetVersionId, status: 'PUBLISHED' },
      counters: { categories: 4 },
    });
    const events = await t.admin.outboxEvent.findMany({
      where: { competitionId: c.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual([
      'competition.requirements_changed',
      'competition.status_changed',
      'competition.published',
    ]);

    const v = published.body.data.version;
    const locked = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}`,
      { ruleSetVersionId: await publishedRuleSet(t) },
      v,
    );
    expect(locked.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['published_ruleset_locked'] },
    });
    const moved = schedule(40);
    const noReason = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}`,
      { startDate: moved.startDate, endDate: moved.endDate },
      v,
    );
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const withReason = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}`,
      { startDate: moved.startDate, endDate: moved.endDate, reason: 'Зал освободился позже' },
      v,
    );
    expect(withReason.status, JSON.stringify(withReason.body)).toBe(200);
    expect(
      await t.admin.outboxEvent.count({ where: { competitionId: c.id, type: 'competition.dates_changed' } }),
    ).toBe(1);
    const stale = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}`,
      { name: 'Другое название' },
      v,
    );
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    // Публичная страница: без входа, только белый список полей; черновики не публикуются.
    const pub = await t.http().get(`/api/public/v1/competitions/${c.slug}`).expect(200);
    expect(pub.headers['cache-control']).toContain('max-age=60');
    expect(pub.body.data).toMatchObject({
      slug: c.slug,
      status: 'REGISTRATION_OPEN',
      requirementsMd: 'Медицинский допуск обязателен.',
      regulationUrl: expect.stringContaining('http://storage.test/test-public/'),
    });
    expect(pub.body.data.categories).toHaveLength(4);
    expect(pub.body.data.requirements.map((r: { kind: string }) => r.kind).sort()).toEqual([
      'CONSENT',
      'DOCUMENT',
      'WEIGH_IN',
    ]);
    expect(pub.body.data).not.toHaveProperty('id');
    const other = await draft(w, { name: 'Черновик для витрины' });
    await t.http().get(`/api/public/v1/competitions/${other.slug}`).expect(404);
    const listed = await t.http().get('/api/public/v1/competitions').expect(200);
    expect(listed.body.data.map((x: { slug: string }) => x.slug)).toContain(c.slug);
    expect(listed.body.data.map((x: { slug: string }) => x.slug)).not.toContain(other.slug);
  });

  it('closing and reopening registration closes and reopens categories; check-in warns about unreviewed applications', async () => {
    const w = await world();
    const c = await publish(w);
    const closed = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'REGISTRATION_CLOSED' },
      c.version,
    );
    expect(closed.status).toBe(200);
    const cats = await w.organizer.agent.get(`/api/v1/competitions/${c.id}/categories`).expect(200);
    expect(new Set(cats.body.data.map((x: { status: string }) => x.status))).toEqual(new Set(['CLOSED']));

    const noDate = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'REGISTRATION_OPEN', reason: 'Продление по просьбе клубов' },
      closed.body.data.version,
    );
    expect(noDate.body.error.details.failed).toEqual(['registration_ends_at_required']);
    const reopened = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      {
        to: 'REGISTRATION_OPEN',
        reason: 'Продление по просьбе клубов',
        registrationEndsAt: new Date(Date.now() + 5 * day).toISOString(),
      },
      closed.body.data.version,
    );
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    const again = await w.organizer.agent.get(`/api/v1/competitions/${c.id}/categories`).expect(200);
    expect(new Set(again.body.data.map((x: { status: string }) => x.status))).toEqual(
      new Set(['REGISTRATION']),
    );

    const closed2 = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'REGISTRATION_CLOSED' },
      reopened.body.data.version,
    );
    // Нерассмотренная заявка — предупреждение, которое пользователь подтверждает.
    const clubId = await createOrg(t);
    await t.admin.application.create({
      data: {
        id: uuidv7(),
        competitionId: c.id,
        organizationId: clubId,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    const warn = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'CHECK_IN' },
      closed2.body.data.version,
    );
    expect(warn.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: [], warnings: ['applications_pending_review'], confirmable: true },
    });
    const checkIn = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'CHECK_IN', confirm: true },
      closed2.body.data.version,
    );
    expect(checkIn.status).toBe(200);
    const audit = await t.admin.auditLog.findFirst({
      where: { entityId: c.id, action: 'competition.status_changed' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.after).toMatchObject({
      status: 'CHECK_IN',
      confirmedWarnings: ['applications_pending_review'],
    });

    const invalid = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'FINISHED' },
      checkIn.body.data.version,
    );
    expect(invalid.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { from: 'CHECK_IN', allowed: ['DRAWING', 'CANCELLED'] },
    });
    const noReady = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'DRAWING' },
      checkIn.body.data.version,
    );
    expect(noReady.body.error.details.failed).toEqual(['no_categories_ready_for_draw']);
    const cancelled = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'CANCELLED' },
      checkIn.body.data.version,
    );
    expect(cancelled.body.error.code).toBe('REASON_REQUIRED');
  });

  it('only a draft can be deleted; its staff lose their roles', async () => {
    const w = await world();
    const c = await draft(w);
    await send(w.organizer, 'delete', `/api/v1/competitions/${c.id}`).expect(204);
    await w.organizer.agent.get(`/api/v1/competitions/${c.id}`).expect(404);
    const staff = await t.admin.competitionMembership.findMany({ where: { competitionId: c.id } });
    expect(staff.map((s) => s.status)).toEqual(['ENDED']);
    const p = await publish(w);
    const res = await send(w.organizer, 'delete', `/api/v1/competitions/${p.id}`);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('competition staff', () => {
  it('the manager invites a secretary by email; only the invitee accepts; nobody appoints themselves', async () => {
    const w = await world();
    const c = await draft(w);
    const self = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/members`, {
      email: w.organizerUser.email,
      roleCode: 'CHIEF_REFEREE',
    });
    expect(self.status).toBe(403);
    const invited = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/members`, {
      email: 'Secretary.New@Test.Local',
      roleCode: 'SECRETARY',
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    expect(invited.body.data).toMatchObject({
      status: 'INVITED',
      invitedEmail: 'secretary.new@test.local',
      user: null,
    });
    const dup = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/members`, {
      email: 'secretary.new@test.local',
      roleCode: 'SECRETARY',
    });
    expect(dup.body.error.code).toBe('ALREADY_EXISTS');

    const mail = (await sentEmails(t, 'competition.invite')).at(-1);
    expect(mail?.to).toBe('secretary.new@test.local');
    const token = new URL(mail?.params.acceptUrl ?? '').searchParams.get('token') ?? '';

    const intruder = await createUser(t);
    const intruderSession = await login(t, intruder.email);
    const wrong = await send(intruderSession, 'post', '/api/v1/competition-invites/accept', { token });
    expect(wrong.status).toBe(403);

    const secretaryUser = await createUser(t, { email: 'secretary.new@test.local' });
    const secretary = await login(t, secretaryUser.email);
    await secretary.agent.get(`/api/v1/competitions/${c.id}`).expect(404);
    const accepted = await send(secretary, 'post', '/api/v1/competition-invites/accept', { token });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.data).toMatchObject({ status: 'ACTIVE', roleCode: 'SECRETARY' });
    const view = await secretary.agent.get(`/api/v1/competitions/${c.id}`).expect(200);
    expect(view.body.data.viewer.roles).toEqual(['SECRETARY']);
    expect(view.body.data.allowedActions).toEqual(
      expect.arrayContaining(['registration.view', 'registration.approve']),
    );
    expect(view.body.data.allowedActions).not.toContain('competition.update');

    const suspended = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}/members/${accepted.body.data.id}`,
      { status: 'SUSPENDED' },
      accepted.body.data.version,
    );
    expect(suspended.status).toBe(200);
    await secretary.agent.get(`/api/v1/competitions/${c.id}`).expect(404);
  });
});

describe('competition categories', () => {
  it('edits bounds, cancels, deletes unused categories and merges small ones before the draw (D-03)', async () => {
    const w = await world();
    const c = await draft(w, { ruleSetVersionId: w.ruleSetVersionId });
    const generated = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/categories/generate`, {
      templateId: w.templateId,
    });
    const byCode = (suffix: string) =>
      generated.body.data.find((x: { code: string }) => x.code.endsWith(suffix));
    const light = byCode('-35');
    const middle = byCode('-38');
    const girls = byCode('-34');

    const mixed = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/categories/merge`, {
      sourceCategoryIds: [girls.id],
      targetCategoryId: middle.id,
      reason: 'Мало участников',
    });
    expect(mixed.body.error.details.failed).toEqual(['gender_mismatch']);

    const merged = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/categories/merge`, {
      sourceCategoryIds: [light.id],
      targetCategoryId: middle.id,
      reason: 'Мало участников',
    });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body.data.weight).toEqual({ kind: 'UP_TO', lowerGrams: null, upperGrams: 38000 });
    const source = await w.organizer.agent
      .get(`/api/v1/competitions/${c.id}/categories/${light.id}`)
      .expect(200);
    expect(source.body.data).toMatchObject({ status: 'MERGED', mergedIntoId: middle.id });

    const openCategory = {
      code: 'M-OPEN',
      name: { ru: 'Юноши, абсолютная', en: 'Boys, open' },
      gender: 'MALE',
      age: { policy: 'BIRTH_YEAR_RANGE', birthYearFrom: 2010, birthYearTo: 2014 },
      weight: { kind: 'ABOVE', lowerGrams: 30000 },
    };
    const custom = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/categories`, openCategory);
    expect(custom.status, JSON.stringify(custom.body)).toBe(201);
    const dupCode = await send(w.organizer, 'post', `/api/v1/competitions/${c.id}/categories`, openCategory);
    expect(dupCode.body.error?.code).toBe('ALREADY_EXISTS');
    const edited = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}/categories/${custom.body.data.id}`,
      { weight: { kind: 'UP_TO', lowerGrams: 30000, upperGrams: 45000 } },
      custom.body.data.version,
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data.weight).toEqual({ kind: 'UP_TO', lowerGrams: 30000, upperGrams: 45000 });
    await send(
      w.organizer,
      'delete',
      `/api/v1/competitions/${c.id}/categories/${custom.body.data.id}`,
    ).expect(204);

    const cancelNoReason = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/categories/${girls.id}/transitions`,
      { to: 'CANCELLED' },
      girls.version,
    );
    expect(cancelNoReason.body.error.code).toBe('REASON_REQUIRED');
    const drawn = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/categories/${girls.id}/transitions`,
      { to: 'DRAWN' },
      girls.version,
    );
    expect(drawn.body.error.code).toBe('INVALID_TRANSITION');
    const cancelled = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/categories/${girls.id}/transitions`,
      { to: 'CANCELLED', reason: 'Нет участниц' },
      girls.version,
    );
    expect(cancelled.body.data.status).toBe('CANCELLED');

    // Журнал синхронизации пишут триггеры: каждое изменение категорий турнира — строка с эпохой права записи.
    const log = await t.admin.syncLog.findMany({
      where: { competitionId: c.id, tableName: 'competition_category' },
    });
    expect(log.length).toBeGreaterThanOrEqual(8);
    expect(new Set(log.map((l) => l.op))).toEqual(new Set(['INSERT', 'UPDATE', 'DELETE']));
    expect(new Set(log.map((l) => l.epoch))).toEqual(new Set([1]));
  });
});

describe('write authority (ADR-21)', () => {
  it('while a venue node holds the lease, operational commands in the cloud are refused; reads still work', async () => {
    const w = await world();
    const c = await publish(w);
    await t.admin.competitionWriteLease.update({
      where: { competitionId: c.id },
      data: { holderType: 'NODE', holderNodeId: uuidv7(), epoch: 2 },
    });
    const patch = await send(
      w.organizer,
      'patch',
      `/api/v1/competitions/${c.id}`,
      { name: 'Попытка' },
      c.version,
    );
    expect(patch.status).toBe(409);
    expect(patch.body.error).toMatchObject({
      code: 'WRITE_AUTHORITY_ELSEWHERE',
      details: { holder: 'NODE', epoch: 2 },
    });
    const transition = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/transitions`,
      { to: 'REGISTRATION_CLOSED' },
      c.version,
    );
    expect(transition.body.error.code).toBe('WRITE_AUTHORITY_ELSEWHERE');
    const cats = await w.organizer.agent.get(`/api/v1/competitions/${c.id}/categories`).expect(200);
    const gen = await send(
      w.organizer,
      'post',
      `/api/v1/competitions/${c.id}/categories/${cats.body.data[0].id}/transitions`,
      { to: 'CLOSED' },
      cats.body.data[0].version,
    );
    expect(gen.body.error.code).toBe('WRITE_AUTHORITY_ELSEWHERE');
    const view = await w.organizer.agent.get(`/api/v1/competitions/${c.id}`).expect(200);
    expect(view.body.data.writeAuthority).toEqual({ holder: 'NODE', epoch: 2 });
  });
});

describe('venues', () => {
  it('an organizer keeps venues; a competition uses a venue of its organizer lineage only', async () => {
    const w = await world();
    const venue = await send(w.organizer, 'post', '/api/v1/venues', {
      ownerOrganizationId: w.organizerOrgId,
      name: 'Дворец спорта',
      city: 'Москва',
      timezone: 'Europe/Moscow',
    });
    expect(venue.status, JSON.stringify(venue.body)).toBe(201);
    const c = await draft(w, { venueId: venue.body.data.id });
    const view = await w.organizer.agent.get(`/api/v1/competitions/${c.id}`).expect(200);
    expect(view.body.data.venue).toMatchObject({ name: 'Дворец спорта', city: 'Москва' });

    const other = await world();
    const foreign = await send(other.organizer, 'post', '/api/v1/competitions', {
      name: 'Чужое место',
      organizerOrganizationId: other.organizerOrgId,
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
      venueId: venue.body.data.id,
      ...schedule(),
    });
    expect(foreign.body.error.details.fields).toEqual([{ path: 'venueId', code: 'not_found' }]);
  });
});
