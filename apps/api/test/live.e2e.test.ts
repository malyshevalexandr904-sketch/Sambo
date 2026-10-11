// Живые данные (Phase 8a; план §1–§3, §7): WebSocket-шлюз — права на каналы (без входа, без прав, чужой Origin,
// Bearer), доставка изменений после команды REST (служебные каналы схватки, ковра, турнира; публичное состояние
// табло со счётом), счёт не шумит в канале турнира, публикация только после commit, пропуск seq → снимок, канал
// уведомлений пользователя — только свои, лимиты, публичный снимок табло (черновик — 404, имя — по согласию).
import {
  LIVE_CLIENT_RATE_PER_SECOND,
  LIVE_EVENTS,
  LIVE_TOPICS,
  LIVE_NAMESPACE,
  LIVE_PATH,
  liveChannel,
  type LiveMessage,
  type LiveSubscribeAck,
  type MatchDetailDto,
  type MatchEventResultDto,
  type PublicMatStateDto,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { liveUserRoom } from '@sde/server-kit';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChangeFeedService, LivePublisherService } from '../src/modules/live';
import { createTestApp, createUser, PASSWORD, resetData, type TestApp } from './helpers/app';
import {
  event,
  getMatch,
  official,
  refereeWorld,
  type RefereeWorld,
  scheduledMatches,
  transition,
} from './helpers/phase7';

let t: TestApp;
let base: string;
const sockets: Socket[] = [];

async function leader(): Promise<void> {
  const feed = t.app.get(ChangeFeedService);
  for (let i = 0; i < 20; i++) {
    if (await feed.ensureLeadership()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('live feed did not become the leader');
}

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  await leader();
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});
afterAll(async () => {
  await t.close();
});

/** Вход через HTTP: cookie сессии (веб) и access token (Bearer). */
async function credentials(email: string): Promise<{ cookie: string; token: string }> {
  const csrfRes = await fetch(`${base}/api/v1/auth/csrf`);
  const csrfCookies = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0] as string);
  const csrf = decodeURIComponent(
    csrfCookies.find((c) => c.startsWith('sde_csrf='))?.slice('sde_csrf='.length) ?? '',
  );
  const login = async (bearer: boolean): Promise<Response> =>
    fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: csrfCookies.join('; '),
        ...(bearer ? { 'x-auth-mode': 'bearer' } : {}),
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
  const web = await login(false);
  expect(web.status).toBe(200);
  const cookie = [...csrfCookies, ...web.headers.getSetCookie().map((c) => c.split(';')[0] as string)].join(
    '; ',
  );
  const mobile = await login(true);
  const body = (await mobile.json()) as { data: { tokens: { accessToken: string } } };
  return { cookie, token: body.data.tokens.accessToken };
}

async function connect(opts: { cookie?: string; origin?: string; token?: string } = {}): Promise<Socket> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  const socket = io(`${base}${LIVE_NAMESPACE}`, {
    path: LIVE_PATH,
    addTrailingSlash: false,
    transports: ['websocket'],
    extraHeaders: headers,
    auth: opts.token ? { token: opts.token } : {},
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (e) => reject(e));
  });
  return socket;
}

const subscribe = (s: Socket, channel: string, lastSeq?: number): Promise<LiveSubscribeAck> =>
  new Promise((resolve) => s.emit(LIVE_EVENTS.subscribe, { channel, lastSeq }, resolve));

/** Все сообщения сокета по порядку прихода. */
function record(s: Socket): LiveMessage[] {
  const out: LiveMessage[] = [];
  s.on(LIVE_EVENTS.message, (m: LiveMessage) => out.push(m));
  return out;
}

async function waitFor<T>(fn: () => T | undefined, ms = 4_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('timeout waiting for a live message');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const settle = (ms = 600): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function emailOf(userId: string): Promise<string> {
  return (await t.admin.user.findUniqueOrThrow({ where: { id: userId } })).email as string;
}

describe('live channels', () => {
  let w: RefereeWorld;
  let slug: string;
  let matchId: string;
  let judge: { cookie: string; token: string };

  beforeAll(async () => {
    w = await refereeWorld(t, [{ admitted: 2, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    await t.admin.matchSchedule.updateMany({
      where: { match: { categoryId } },
      data: { matId: w.mats[0]!.id },
    });
    const [first] = await scheduledMatches(t, categoryId);
    matchId = first!.id;
    slug = (await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } })).slug;
    judge = await credentials(await emailOf(w.refs.judge1.id));
  });

  it('service channels need a session with rights; a cookie from a foreign site counts as no session', async () => {
    const anon = await connect();
    expect(await subscribe(anon, liveChannel.opsCompetition(w.competitionId))).toEqual({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(await subscribe(anon, liveChannel.user)).toEqual({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });

    const outsider = await createUser(t);
    const out = await connect({ cookie: (await credentials(outsider.email)).cookie });
    expect(await subscribe(out, liveChannel.opsMat(w.mats[0]!.id))).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });

    const foreign = await connect({ cookie: judge.cookie, origin: 'https://evil.example' });
    expect(await subscribe(foreign, liveChannel.opsMatch(matchId))).toEqual({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });

    const web = await connect({ cookie: judge.cookie, origin: 'http://localhost:3000' });
    expect(await subscribe(web, liveChannel.opsMatch(matchId))).toMatchObject({ ok: true, snapshot: null });
    const app = await connect({ token: judge.token });
    expect(await subscribe(app, liveChannel.opsCompetition(w.competitionId))).toMatchObject({ ok: true });
    // Несуществующий ковёр — 404, мусор вместо имени канала — ошибка валидации.
    expect(await subscribe(app, liveChannel.opsMat(uuidv7()))).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await subscribe(app, 'ops:everything')).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('a revoked session can no longer subscribe to service channels; public ones stay available', async () => {
    const someone = await credentials(await emailOf(w.refs.judge2.id));
    const s = await connect({ token: someone.token });
    expect(await subscribe(s, liveChannel.opsCompetition(w.competitionId))).toMatchObject({ ok: true });
    const out = await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${someone.token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(out.status).toBeLessThan(300);
    expect(await subscribe(s, liveChannel.opsMat(w.mats[1]!.id))).toEqual({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(await subscribe(s, liveChannel.publicMat(slug, 1))).toMatchObject({ ok: true });
  });

  it('a REST command reaches the match, mat and competition channels and the public scoreboard', async () => {
    await settle();
    const staff = await connect({ token: judge.token });
    const viewer = await connect();
    const staffMsgs = record(staff);
    const viewerMsgs = record(viewer);
    for (const c of [
      liveChannel.opsMatch(matchId),
      liveChannel.opsMat(w.mats[0]!.id),
      liveChannel.opsCompetition(w.competitionId),
    ])
      expect(await subscribe(staff, c)).toMatchObject({ ok: true });
    const board = await subscribe(viewer, liveChannel.publicMat(slug, 1));
    expect(board.ok).toBe(true);
    const snapshot = board.ok ? (board.snapshot?.payload as PublicMatStateDto) : null;
    expect(snapshot?.mat.number).toBe(1);
    expect(snapshot?.channel).toBe(liveChannel.publicMat(slug, 1));

    let m = await getMatch(w.refs.judge1.s, matchId);
    const called = await transition(w.refs.judge1.s, m, 'READY');
    expect(called.status, JSON.stringify(called.body)).toBe(200);
    const competitionMsg = await waitFor(() =>
      staffMsgs.find(
        (x) =>
          x.channel === liveChannel.opsCompetition(w.competitionId) &&
          (x.payload as { topics: string[] }).topics.includes('matches'),
      ),
    );
    expect(competitionMsg).toMatchObject({ v: 1, type: 'changed' });
    expect((competitionMsg.payload as { topics: string[]; matchIds: string[] }).topics).toContain('matches');
    expect((competitionMsg.payload as { matchIds: string[] }).matchIds).toContain(matchId);
    await waitFor(() => staffMsgs.find((x) => x.channel === liveChannel.opsMat(w.mats[0]!.id)));
    const calledState = await waitFor(() =>
      viewerMsgs.find(
        (x) => x.type === 'mat.state' && (x.payload as PublicMatStateDto).current?.status === 'READY',
      ),
    );
    expect((calledState.payload as PublicMatStateDto).current?.score).toBeNull();

    m = called.body.data as MatchDetailDto;
    const started = await transition(w.refs.judge1.s, m, 'IN_PROGRESS');
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    m = started.body.data as MatchDetailDto;
    let seq = m.seq;
    const clock = await event(w.refs.judge1.s, matchId, {
      type: 'CLOCK_STARTED',
      matchClockMs: 0,
      expectedSeq: seq,
    });
    expect(clock.status, JSON.stringify(clock.body)).toBe(201);
    seq = (clock.body.data as MatchEventResultDto).seq;
    await waitFor(() =>
      viewerMsgs.find((x) => (x.payload as PublicMatStateDto).current?.clock?.running === true),
    );
    await settle();
    const before = staffMsgs.filter((x) => x.channel === liveChannel.opsCompetition(w.competitionId)).length;
    const matchBefore = staffMsgs.filter((x) => x.channel === liveChannel.opsMatch(matchId)).length;

    const score = await event(w.refs.judge1.s, matchId, {
      type: 'SCORE',
      side: 'RED',
      actionCode: 'THROW_4',
      matchClockMs: 20_000,
      expectedSeq: seq,
    });
    expect(score.status, JSON.stringify(score.body)).toBe(201);
    const scored = await waitFor(() =>
      viewerMsgs.find((x) => (x.payload as PublicMatStateDto).current?.score?.red.points === 4),
    );
    const live = (scored.payload as PublicMatStateDto).current!;
    expect(live.status).toBe('IN_PROGRESS');
    // Время по часам сервера: момент последнего пуска секундомера — не позже текущего времени сервера.
    expect(live.clock?.running).toBe(true);
    expect(Date.parse(live.clock!.at!)).toBeLessThanOrEqual(Date.now() + 1_000);
    await waitFor(() =>
      staffMsgs.filter((x) => x.channel === liveChannel.opsMatch(matchId)).length > matchBefore
        ? true
        : undefined,
    );
    await settle();
    // Оценка — изменение только счёта: канал турнира (экраны «Судейство», «Итоги») не дёргается.
    expect(staffMsgs.filter((x) => x.channel === liveChannel.opsCompetition(w.competitionId)).length).toBe(
      before,
    );

    // Номера сообщений канала идут подряд.
    const boardSeqs = viewerMsgs
      .filter((x) => x.channel === liveChannel.publicMat(slug, 1))
      .map((x) => x.seq);
    expect(boardSeqs).toEqual([...boardSeqs].sort((a, b) => a - b));
    expect(new Set(boardSeqs).size).toBe(boardSeqs.length);
  });

  it('publishes only committed changes', async () => {
    const staff = await connect({ token: judge.token });
    const msgs = record(staff);
    expect(await subscribe(staff, liveChannel.opsMatch(matchId))).toMatchObject({ ok: true });
    await t.admin
      .$transaction(async (tx) => {
        await tx.match.update({ where: { id: matchId }, data: { version: { increment: 1 } } });
        throw new Error('rollback');
      })
      .catch(() => undefined);
    await settle(800);
    expect(msgs).toEqual([]);
  });

  it('a subscriber that missed messages gets the latest state; an up-to-date one gets nothing extra', async () => {
    const viewer = await connect();
    const first = await subscribe(viewer, liveChannel.publicMat(slug, 1));
    if (!first.ok) throw new Error('subscribe failed');
    expect(first.snapshot).not.toBeNull();
    const again = await subscribe(viewer, liveChannel.publicMat(slug, 1), first.seq);
    expect(again).toEqual({ ok: true, seq: first.seq, snapshot: null });
    const behind = await subscribe(viewer, liveChannel.publicMat(slug, 1), Math.max(0, first.seq - 1));
    expect(behind.ok && behind.snapshot?.type).toBe('mat.state');
  });

  it('the user channel delivers only own notifications', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const sa = await connect({ token: (await credentials(a.email)).token });
    const sb = await connect({ token: (await credentials(b.email)).token });
    const ma = record(sa);
    const mb = record(sb);
    expect(await subscribe(sa, liveChannel.user)).toMatchObject({ ok: true, seq: 0 });
    expect(await subscribe(sb, liveChannel.user)).toMatchObject({ ok: true });
    await t.app.get(LivePublisherService).publish({
      channel: liveChannel.user,
      room: liveUserRoom(a.id),
      type: 'notification',
      payload: { notificationId: uuidv7(), type: 'results.published' },
    });
    const got = await waitFor(() => ma[0]);
    expect(got).toMatchObject({ channel: 'user', seq: 1, type: 'notification' });
    await settle(300);
    expect(mb).toEqual([]);
  });

  it('a role removed in the tournament stops new service subscriptions on an open connection at once', async () => {
    const ref = await official(t, w.competitionId);
    const s = await connect({ token: (await credentials(await emailOf(ref.id))).token });
    expect(await subscribe(s, liveChannel.opsCompetition(w.competitionId))).toMatchObject({ ok: true });
    // Как PATCH участника турнира (staff.service): должность снята, версия прав пользователя выросла.
    await t.admin.competitionMembership.updateMany({
      where: { competitionId: w.competitionId, userId: ref.id },
      data: { status: 'ENDED' },
    });
    await t.admin.user.update({ where: { id: ref.id }, data: { permissionsVersion: { increment: 1 } } });
    expect(await subscribe(s, liveChannel.opsMat(w.mats[0]!.id))).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('an unsubscribe sent while the subscription is still being checked wins', async () => {
    const s = await connect({ token: judge.token });
    const msgs = record(s);
    const channel = liveChannel.opsMatch(matchId);
    const sub = subscribe(s, channel);
    const unsub = new Promise((resolve) => s.emit(LIVE_EVENTS.unsubscribe, { channel }, resolve));
    expect(await sub).toMatchObject({ ok: true });
    expect(await unsub).toEqual({ ok: true });
    await t.app.get(LivePublisherService).publish({
      channel,
      type: 'changed',
      payload: { topics: ['matches'], categoryIds: [], matIds: [], matchIds: [matchId] },
    });
    await settle(300);
    expect(msgs.filter((m) => m.channel === channel)).toEqual([]);
  });

  it('limits client requests per second', async () => {
    const s = await connect({ token: judge.token });
    const acks = await Promise.all(
      Array.from({ length: LIVE_CLIENT_RATE_PER_SECOND + 5 }, () => subscribe(s, 'not-a-channel')),
    );
    expect(
      acks.slice(0, LIVE_CLIENT_RATE_PER_SECOND).every((a) => !a.ok && a.error.code === 'VALIDATION_FAILED'),
    ).toBe(true);
    expect(
      acks.slice(LIVE_CLIENT_RATE_PER_SECOND).every((a) => !a.ok && a.error.code === 'RATE_LIMITED'),
    ).toBe(true);
  });

  it('a new leader node resyncs the screens of active tournaments (changes nobody listened to)', async () => {
    const staff = await connect({ token: judge.token });
    const msgs = record(staff);
    expect(await subscribe(staff, liveChannel.opsCompetition(w.competitionId))).toMatchObject({ ok: true });
    const viewer = await connect();
    const boards = record(viewer);
    expect(await subscribe(viewer, liveChannel.publicMat(slug, 1))).toMatchObject({ ok: true });
    // Блокировка ведущего пропала (истекла, пока узел стоял): узел теряет роль и занимает её заново.
    const feed = t.app.get(ChangeFeedService);
    feed.resyncMinIntervalMs = 0;
    await t.redis.del('sde:live:leader');
    expect(await feed.ensureLeadership()).toBe(true);
    const resync = await waitFor(() =>
      msgs.find(
        (x) =>
          x.channel === liveChannel.opsCompetition(w.competitionId) &&
          (x.payload as { topics: string[] }).topics.length === LIVE_TOPICS.length,
      ),
    );
    expect(resync.type).toBe('changed');
    await waitFor(() => boards.find((x) => x.type === 'mat.state'));
  });
});

describe('public scoreboard snapshot', () => {
  it('is 404 for a draft tournament; names are shown only with consent to distribution', async () => {
    const w = await refereeWorld(t, [{ admitted: 2, format: 'SINGLE_ELIMINATION' }]);
    const matId = w.mats[0]!.id;
    const categoryId = w.categories[0]!.categoryId;
    await t.admin.matchSchedule.updateMany({ where: { match: { categoryId } }, data: { matId } });
    const r = await t.http().get(`/api/public/v1/mats/${matId}/scoreboard`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const state = r.body.data as PublicMatStateDto;
    const shown = state.next ?? state.current;
    expect(shown).not.toBeNull();
    expect(shown!.red).toMatchObject({ name: null, hidden: true });
    expect(shown!.red.club).not.toBeNull();
    // Только публичные поля: ни идентификаторов участий, ни полного имени.
    expect(JSON.stringify(r.body)).not.toMatch(/entryId|snapLastName|birth/i);

    const [match] = await scheduledMatches(t, categoryId);
    const entryId = match!.participants.find((p) => p.side === 'RED')!.entryId!;
    const entry = await t.admin.entry.findUniqueOrThrow({
      where: { id: entryId },
      include: { athlete: { select: { personId: true } } },
    });
    const templateId = uuidv7();
    await t.admin.consentTemplate.create({
      data: {
        id: templateId,
        kind: 'PD_DISTRIBUTION',
        version: 1,
        locale: 'ru',
        operatorName: 'Оператор',
        bodyMarkdown: 'Согласие на распространение',
        publishedAt: new Date(),
      },
    });
    await t.admin.consent.create({
      data: {
        id: uuidv7(),
        subjectPersonId: entry.athlete.personId,
        givenByPersonId: entry.athlete.personId,
        templateId,
        method: 'ELECTRONIC',
        givenAt: new Date(),
      },
    });
    const after = (await t.http().get(`/api/public/v1/mats/${matId}/scoreboard`)).body
      .data as PublicMatStateDto;
    const red = after.next?.red ?? after.current?.red;
    expect(red).toMatchObject({ name: entry.publicName, hidden: false });

    const slug = (await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } })).slug;
    // Снимок табло этого ковра сохраняется публикацией (расписание изменено выше), пока турнир опубликован.
    await t.app.get(ChangeFeedService).drain();
    const retained = `sde:live:last:${liveChannel.publicMat(slug, 1)}`;
    for (let i = 0; i < 40 && !(await t.redis.exists(retained)); i++) await settle(50);
    expect(await t.redis.exists(retained)).toBe(1);
    await t.admin.competition.update({ where: { id: w.competitionId }, data: { status: 'DRAFT' } });
    expect((await t.http().get(`/api/public/v1/mats/${matId}/scoreboard`)).status).toBe(404);
    // Сохранённый снимок остался с тех пор, как турнир был опубликован, — но подписка его не получит.
    expect(await t.redis.exists(retained)).toBe(1);
    const viewer = await connect();
    expect(await subscribe(viewer, liveChannel.publicMat(slug, 1))).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect((await t.http().get(`/api/public/v1/mats/${uuidv7()}/scoreboard`)).status).toBe(404);
  });
});
