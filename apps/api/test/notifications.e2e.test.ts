// Уведомления пользователя (Phase 4b): лента с подстановками из исходных записей, прочтение, настройки каналов.
// Сами уведомления создаёт worker (apps/worker/test/notifications.e2e.test.ts); здесь они — фикстуры.
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createTestApp, createUser, login, resetData, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import { ensureCompetition } from './helpers/phase4';

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
    expect(defaults.body.data).toHaveLength(4);
    expect(
      defaults.body.data.every(
        (p: { channel: string; enabled: boolean }) => p.channel === 'EMAIL' && p.enabled,
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
});
