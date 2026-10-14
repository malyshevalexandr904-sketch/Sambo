// Уведомления пользователя (Phase 4b): лента с подстановками из исходных записей, прочтение, настройки каналов.
// Сами уведомления создаёт worker (apps/worker/test/notifications.e2e.test.ts); здесь они — фикстуры.
import { CONFIGURABLE_CHANNELS, NOTIFICATION_TYPES } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createTestApp, createUser, login, resetData, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import { clubAthlete, ensureCompetition, publishedRuleSet } from './helpers/phase4';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

async function notify(userId: string, type: string, params: Record<string, string>, createdAt = new Date()) {
  const id = uuidv7();
  await t.admin.notification.create({ data: { id, userId, type, params, createdAt } });
  return id;
}

describe('notifications', () => {
  it('lists own notifications newest first with names and reasons from the source records', async () => {
    const clubId = await createOrg(t);
    const coachUser = await createUser(t, { orgs: [{ organizationId: clubId, role: 'COACH' }] });
    const competitionId = await ensureCompetition(t, uuidv7());
    const applicationId = uuidv7();
    await t.admin.application.create({
      data: {
        id: applicationId,
        competitionId,
        organizationId: clubId,
        status: 'WAITING_DOCUMENTS',
        submittedAt: new Date(),
        reviewComment: 'Нет свидетельства о рождении',
      },
    });
    const older = await notify(
      coachUser.id,
      'application.returned',
      { applicationId },
      new Date(Date.now() - 60_000),
    );
    const newer = await notify(coachUser.id, 'application.decided', { applicationId, status: 'APPROVED' });
    const coach = await login(t, coachUser.email);

    const list = await coach.agent.get('/api/v1/me/notifications').expect(200);
    expect(list.body.data.map((n: { id: string }) => n.id)).toEqual([newer, older]);
    expect(list.body.data[1]).toMatchObject({
      type: 'application.returned',
      params: { applicationId },
      link: `/applications/${applicationId}`,
      readAt: null,
      context: { reason: 'Нет свидетельства о рождении' },
    });
    expect(list.body.data[1].context.competitionName).toMatch(/^Турнир/);
    expect(list.body.data[0].context).toMatchObject({ status: 'APPROVED' });
    expect((await coach.agent.get('/api/v1/me/notifications/unread-count').expect(200)).body.data).toEqual({
      unread: 2,
    });

    // Чужое уведомление не прочитать; своё — прочитано; «прочитать все».
    const other = await login(t, (await createUser(t)).email);
    expect((await send(other, 'post', `/api/v1/me/notifications/${older}/read`)).status).toBe(404);
    expect((await other.agent.get('/api/v1/me/notifications').expect(200)).body.data).toEqual([]);
    await send(coach, 'post', `/api/v1/me/notifications/${older}/read`).expect(204);
    const unread = await coach.agent
      .get('/api/v1/me/notifications')
      .query({ unreadOnly: 'true' })
      .expect(200);
    expect(unread.body.data.map((n: { id: string }) => n.id)).toEqual([newer]);
    await send(coach, 'post', '/api/v1/me/notifications/read-all').expect(204);
    expect((await coach.agent.get('/api/v1/me/notifications/unread-count')).body.data.unread).toBe(0);

    // Ушёл из клуба — видит лишь название турнира, без причины и организации.
    await t.admin.organizationMembership.updateMany({
      where: { userId: coachUser.id },
      data: { status: 'ENDED' },
    });
    await t.admin.user.update({
      where: { id: coachUser.id },
      data: { permissionsVersion: { increment: 1 } },
    });
    const again = await login(t, coachUser.email);
    const after = await again.agent.get('/api/v1/me/notifications').expect(200);
    expect(Object.keys(after.body.data[1].context)).toEqual(['competitionName']);
  });

  it('email can be switched off per type; the in-app feed is not configurable', async () => {
    const s = await login(t, (await createUser(t)).email);
    const defaults = await s.agent.get('/api/v1/me/notification-preferences').expect(200);
    // По строке на каждый вид уведомления и настраиваемый канал (Phase 8a: + «опубликованы результаты»; 8b: push
    // и уведомления дня соревнований — письма о них по умолчанию выключены).
    expect(defaults.body.data).toHaveLength(NOTIFICATION_TYPES.length * CONFIGURABLE_CHANNELS.length);
    expect(
      defaults.body.data.every(
        (p: { type: string; channel: string; enabled: boolean }) =>
          p.enabled === (p.channel === 'PUSH' || !p.type.startsWith('match.')),
      ),
    ).toBe(true);
    const put = await send(s, 'put', '/api/v1/me/notification-preferences', {
      preferences: [{ type: 'document.rejected', channel: 'EMAIL', enabled: false }],
    }).expect(200);
    expect(put.body.data).toContainEqual({ type: 'document.rejected', channel: 'EMAIL', enabled: false });
    expect(put.body.data).toContainEqual({ type: 'entry.rejected', channel: 'EMAIL', enabled: true });
    const inApp = await send(s, 'put', '/api/v1/me/notification-preferences', {
      preferences: [{ type: 'document.rejected', channel: 'IN_APP', enabled: false }],
    });
    expect(inApp.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('match-day notifications show the mat, bout and time; the athlete name only while the card is visible', async () => {
    const clubId = await createOrg(t);
    const coachUser = await createUser(t, { orgs: [{ organizationId: clubId, role: 'COACH' }] });
    const competitionId = await ensureCompetition(t, uuidv7(), {
      status: 'REGISTRATION_OPEN',
      ruleSetVersionId: await publishedRuleSet(t),
    });
    const categoryId = uuidv7();
    await t.admin.competitionCategory.create({
      data: {
        id: categoryId,
        competitionId,
        code: `M-${categoryId.slice(-6).toUpperCase()}`,
        nameRu: 'Юноши до 46 кг',
        nameEn: 'Boys up to 46 kg',
        gender: 'MALE',
        agePolicy: 'BY_BIRTH_YEAR',
        weightKind: 'UP_TO',
        weightUpperGrams: 46_000,
      },
    });
    const { athleteId } = await clubAthlete(t, { clubId, lastName: 'Самбистов' });
    const applicationId = uuidv7();
    await t.admin.application.create({
      data: {
        id: applicationId,
        competitionId,
        organizationId: clubId,
        status: 'APPROVED',
        submittedAt: new Date(),
      },
    });
    const entryId = uuidv7();
    await t.admin.entry.create({
      data: {
        id: entryId,
        competitionId,
        applicationId,
        athleteId,
        categoryId,
        declaredCategoryId: categoryId,
        status: 'APPROVED',
        snapLastName: 'Самбистов',
        snapFirstName: 'Иван',
        snapBirthDate: new Date('2013-03-10'),
        snapGender: 'MALE',
        publicName: 'Самбистов И.',
      },
    });
    const matId = uuidv7();
    await t.admin.mat.create({ data: { id: matId, competitionId, number: 3 } });
    const sessionId = uuidv7();
    await t.admin.session.create({
      data: {
        id: sessionId,
        competitionId,
        name: 'Утро',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600_000),
      },
    });
    const matchId = uuidv7();
    await t.admin.match.create({
      data: {
        id: matchId,
        competitionId,
        categoryId,
        publicId: 'MatchPub1234',
        matchNumber: 27,
        roundLabel: 'R1',
      },
    });
    await t.admin.matchParticipant.create({
      data: { id: uuidv7(), competitionId, matchId, side: 'RED', entryId },
    });
    const plannedAt = new Date('2026-11-14T08:30:00.000Z');
    await t.admin.matchSchedule.create({
      data: { id: uuidv7(), competitionId, matchId, sessionId, matId, orderInMat: 1, plannedAt },
    });
    const params = { competitionId, matchId, athleteId, entryId, ahead: '2' };
    await notify(coachUser.id, 'match.soon', params);
    const coach = await login(t, coachUser.email);
    const [n] = (await coach.agent.get('/api/v1/me/notifications').expect(200)).body.data;
    expect(n).toMatchObject({
      type: 'match.soon',
      params,
      link: `/athletes/${athleteId}`,
      context: {
        athleteName: 'Самбистов И.',
        matNumber: '3',
        matchNumber: '27',
        plannedAt: plannedAt.toISOString(),
        timezone: 'Europe/Moscow',
      },
    });
    expect(n.context.competitionName).toMatch(/^Турнир/);

    // Тренер ушёл из клуба — карточку больше не видит: схватка остаётся, имени нет.
    await t.admin.organizationMembership.updateMany({
      where: { userId: coachUser.id },
      data: { status: 'ENDED' },
    });
    await t.admin.user.update({
      where: { id: coachUser.id },
      data: { permissionsVersion: { increment: 1 } },
    });
    const again = await login(t, coachUser.email);
    const [after] = (await again.agent.get('/api/v1/me/notifications').expect(200)).body.data;
    expect(after.context.athleteName).toBeUndefined();
    expect(after.context.matNumber).toBe('3');
  });
});
