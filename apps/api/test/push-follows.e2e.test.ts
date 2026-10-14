// Web Push и подписки на спортсменов (Phase 8b; API.md, 5.8): устройство привязано к сессии входа, повтор — то же
// устройство, onlyIfMine не перехватывает чужое, адреса push-служб проверяются (SSRF), лимит устройств; подписка
// на спортсмена — только с доступом к карточке (иначе 404), на всю заявку — только клубу заявки.
import { createECDH, randomBytes } from 'node:crypto';
import { MAX_PUSH_DEVICES, NOTIFICATION_TYPES, notificationChannelDefault } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { webPushKeys } from '@sde/server-kit';
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
import { clubAthlete, ensureCompetition, publishedRuleSet } from './helpers/phase4';
import { TEST_ENV } from './test-env';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

/** Подписка браузера: адрес push-службы и ключи устройства (P-256, 16 байт секрета). */
function browserSubscription(endpoint = `https://fcm.googleapis.com/fcm/send/${uuidv7()}`) {
  const ecdh = createECDH('prime256v1');
  return {
    endpoint,
    keys: {
      p256dh: ecdh.generateKeys().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

async function sessionOf(userId: string): Promise<string> {
  const rows = await t.admin.refreshToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return rows[0]?.familyId as string;
}

const put = (s: Session, body: object) => send(s, 'put', '/api/v1/me/push/subscriptions', body);

describe('push devices', () => {
  it('gives the VAPID key; subscribes this device to the login session; a repeat updates the same device', async () => {
    const u = await createUser(t);
    const s = await login(t, u.email);
    const config = await s.agent.get('/api/v1/me/push/config').expect(200);
    expect(config.body.data).toEqual({
      enabled: true,
      publicKey: webPushKeys({ ...TEST_ENV, EMAIL_FROM: 'noreply@sambo.test' }).publicKey,
    });

    const sub = browserSubscription();
    const first = await put(s, sub).expect(200);
    expect(first.body.data).toEqual({
      id: expect.any(String),
      userAgent: null, // тестовый клиент не присылает User-Agent
      createdAt: expect.any(String),
      lastUsedAt: null,
    });
    // Адрес push-службы клиенту не возвращается (список устройств — только браузер и даты).
    expect(JSON.stringify(first.body)).not.toContain(sub.endpoint);
    const row = await t.admin.pushSubscription.findUniqueOrThrow({ where: { endpoint: sub.endpoint } });
    expect(row.sessionId).toBe(await sessionOf(u.id));

    const again = await put(s, { ...sub, keys: browserSubscription().keys }).expect(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await t.admin.pushSubscription.count({ where: { userId: u.id } })).toBe(1);

    const list = await s.agent.get('/api/v1/me/push/subscriptions').expect(200);
    expect(list.body.data.map((d: { id: string }) => d.id)).toEqual([first.body.data.id]);
  });

  it('onlyIfMine never takes another user’s device; an explicit subscribe moves it to the new user', async () => {
    const a = await login(t, (await createUser(t)).email);
    const bUser = await createUser(t);
    const b = await login(t, bUser.email);
    const sub = browserSubscription();
    await put(a, sub).expect(200);
    // B вошёл на том же браузере: приложение тихо обновляет привязку — чужое устройство не трогается.
    const silent = await put(b, { ...sub, onlyIfMine: true });
    expect(silent.status).toBe(204);
    expect(
      (await t.admin.pushSubscription.findUniqueOrThrow({ where: { endpoint: sub.endpoint } })).userId,
    ).not.toBe(bUser.id);
    // Явная подписка B («Получать на этом устройстве») — устройство теперь его.
    await put(b, sub).expect(200);
    const row = await t.admin.pushSubscription.findUniqueOrThrow({ where: { endpoint: sub.endpoint } });
    expect(row.userId).toBe(bUser.id);
    expect(row.sessionId).toBe(await sessionOf(bUser.id));
    expect((await a.agent.get('/api/v1/me/push/subscriptions').expect(200)).body.data).toEqual([]);
  });

  it('rejects internal push addresses and malformed keys', async () => {
    const s = await login(t, (await createUser(t)).email);
    for (const endpoint of [
      'http://push.example.com/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://push.local/x',
      'https://intranet/x',
      'https://user:pw@push.example.com/x',
      'https://push.example.com:8443/x',
    ]) {
      const res = await put(s, browserSubscription(endpoint));
      expect(res.status, endpoint).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    const bad = browserSubscription();
    const shortKey = await put(s, {
      ...bad,
      keys: { ...bad.keys, p256dh: Buffer.alloc(64, 4).toString('base64url') },
    });
    expect(shortKey.status).toBe(400);
    const badAuth = await put(s, {
      ...bad,
      keys: { ...bad.keys, auth: randomBytes(12).toString('base64url') },
    });
    expect(badAuth.status).toBe(400);
    expect(await t.admin.pushSubscription.count({ where: { endpoint: bad.endpoint } })).toBe(0);
  });

  it('removes own devices only; keeps at most the newest devices; needs a login', async () => {
    const owner = await createUser(t);
    const s = await login(t, owner.email);
    const other = await login(t, (await createUser(t)).email);
    const subs = Array.from({ length: MAX_PUSH_DEVICES + 1 }, () => browserSubscription());
    for (const sub of subs) await put(s, sub).expect(200);
    const left = await t.admin.pushSubscription.findMany({ where: { userId: owner.id } });
    expect(left).toHaveLength(MAX_PUSH_DEVICES);
    expect(left.map((r) => r.endpoint)).not.toContain(subs[0]?.endpoint);

    // Чужое устройство — 404 и по id, и по адресу (без изменений).
    const mine = left[0]!;
    expect((await send(other, 'delete', `/api/v1/me/push/subscriptions/${mine.id}`)).status).toBe(404);
    await send(other, 'delete', '/api/v1/me/push/subscriptions', { endpoint: mine.endpoint }).expect(204);
    expect(await t.admin.pushSubscription.count({ where: { id: mine.id } })).toBe(1);
    // Выход на устройстве: отписка по адресу; «Удалить» в настройках — по id.
    await send(s, 'delete', '/api/v1/me/push/subscriptions', { endpoint: mine.endpoint }).expect(204);
    await send(s, 'delete', `/api/v1/me/push/subscriptions/${left[1]!.id}`).expect(204);
    expect(await t.admin.pushSubscription.count({ where: { userId: owner.id } })).toBe(MAX_PUSH_DEVICES - 2);

    const anon = await t.http().get('/api/v1/me/push/config');
    expect(anon.status).toBe(401);
  });

  it('push is a configurable channel: on by default, email off for match-day notifications', async () => {
    const s = await login(t, (await createUser(t)).email);
    const prefs = (await s.agent.get('/api/v1/me/notification-preferences').expect(200)).body.data as {
      type: string;
      channel: 'EMAIL' | 'PUSH';
      enabled: boolean;
    }[];
    expect(prefs).toHaveLength(NOTIFICATION_TYPES.length * 2);
    for (const p of prefs)
      expect(p.enabled, `${p.type}:${p.channel}`).toBe(
        notificationChannelDefault(p.type as never, p.channel),
      );
    expect(prefs).toContainEqual({ type: 'match.soon', channel: 'EMAIL', enabled: false });
    expect(prefs).toContainEqual({ type: 'match.soon', channel: 'PUSH', enabled: true });
    const res = await send(s, 'put', '/api/v1/me/notification-preferences', {
      preferences: [{ type: 'match.started', channel: 'PUSH', enabled: false }],
    }).expect(200);
    expect(res.body.data).toContainEqual({ type: 'match.started', channel: 'PUSH', enabled: false });
  });
});

/** Клуб, тренер, турнир, категория и заявка: два одобренных участия и одно снятое. */
async function applicationWorld() {
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
  const athletes: string[] = [];
  for (const status of ['APPROVED', 'APPROVED', 'WITHDRAWN'] as const) {
    const { athleteId } = await clubAthlete(t, { clubId, lastName: `Борцов${athletes.length}` });
    await t.admin.entry.create({
      data: {
        id: uuidv7(),
        competitionId,
        applicationId,
        athleteId,
        categoryId,
        declaredCategoryId: categoryId,
        status,
        withdrawReason: status === 'WITHDRAWN' ? 'Травма' : null,
        snapLastName: 'Борцов',
        snapFirstName: 'Иван',
        snapBirthDate: new Date('2013-03-10'),
        snapGender: 'MALE',
        publicName: 'Борцов И.',
      },
    });
    athletes.push(athleteId);
  }
  return { clubId, coachUser, competitionId, applicationId, athletes };
}

describe('follows', () => {
  it('only someone who sees the athlete card can follow; others get 404 and learn nothing', async () => {
    const w = await applicationWorld();
    const coach = await login(t, w.coachUser.email);
    const athleteId = w.athletes[0]!;
    expect((await coach.agent.get(`/api/v1/athletes/${athleteId}/follow`).expect(200)).body.data).toEqual({
      following: false,
    });
    expect((await send(coach, 'put', `/api/v1/athletes/${athleteId}/follow`).expect(200)).body.data).toEqual({
      following: true,
    });
    await send(coach, 'put', `/api/v1/athletes/${athleteId}/follow`).expect(200);
    expect(await t.admin.follow.count({ where: { userId: w.coachUser.id } })).toBe(1);
    const mine = (await coach.agent.get('/api/v1/me/follows').expect(200)).body.data;
    expect(mine).toEqual([
      { athleteId, name: expect.stringMatching(/^Борцов0 /), createdAt: expect.any(String) },
    ]);

    const outsider = await login(t, (await createUser(t)).email);
    expect((await send(outsider, 'put', `/api/v1/athletes/${athleteId}/follow`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/v1/athletes/${athleteId}/follow`)).status).toBe(404);
    expect((await send(outsider, 'put', `/api/v1/athletes/${uuidv7()}/follow`)).status).toBe(404);
    // Отписка — своя строка, тот же ответ при любом спортсмене.
    expect(
      (await send(outsider, 'delete', `/api/v1/athletes/${athleteId}/follow`).expect(200)).body.data,
    ).toEqual({
      following: false,
    });
    await send(coach, 'delete', `/api/v1/athletes/${athleteId}/follow`).expect(200);
    expect(await t.admin.follow.count({ where: { userId: w.coachUser.id } })).toBe(0);
  });

  it('the club of an application follows all its approved athletes at once and unfollows them', async () => {
    const w = await applicationWorld();
    const coach = await login(t, w.coachUser.email);
    const on = await send(coach, 'post', `/api/v1/applications/${w.applicationId}/follow`, {
      follow: true,
    }).expect(200);
    expect(on.body.data).toEqual({ following: 2, total: 2 });
    const rows = await t.admin.follow.findMany({ where: { userId: w.coachUser.id } });
    expect(rows.map((r) => r.targetId).sort()).toEqual([w.athletes[0], w.athletes[1]].sort());
    // Повтор — без дублей.
    await send(coach, 'post', `/api/v1/applications/${w.applicationId}/follow`, {}).expect(200);
    expect(await t.admin.follow.count({ where: { userId: w.coachUser.id } })).toBe(2);
    const off = await send(coach, 'post', `/api/v1/applications/${w.applicationId}/follow`, {
      follow: false,
    });
    expect(off.body.data).toEqual({ following: 0, total: 2 });

    const outsider = await login(t, (await createUser(t)).email);
    const res = await send(outsider, 'post', `/api/v1/applications/${w.applicationId}/follow`, {});
    expect(res.status).toBe(404);
  });
});
