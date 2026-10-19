// Рейтинг, фаза 13 (docs/RATING_ARCHITECTURE.md, 8, 9): изменения рейтинга на публичной странице рейтингового
// турнира (rating-summary, rated-matches) и живое уведомление после каждого расчёта.
import {
  LIVE_EVENTS,
  LIVE_NAMESPACE,
  LIVE_PATH,
  liveChannel,
  type LiveMessage,
  type LiveSubscribeAck,
  type PublicCompetition,
  type PublicCompetitionRatingSummary,
  type PublicRatedMatch,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChangeFeedService } from '../src/modules/live';
import { RatingCalculationService, RatingRulesService } from '../src/modules/rating';
import { createTestApp, resetData, type TestApp } from './helpers/app';
import {
  confirm,
  playToResult,
  refereeWorld,
  type RefereeWorld,
  scheduledMatches,
  type ScheduledMatch,
} from './helpers/phase7';

let t: TestApp;
let base: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  const feed = t.app.get(ChangeFeedService);
  for (let i = 0; i < 20 && !(await feed.ensureLeadership()); i++)
    await new Promise((r) => setTimeout(r, 100));
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});
afterAll(async () => {
  await t.close();
});

async function connect(): Promise<Socket> {
  const socket = io(`${base}${LIVE_NAMESPACE}`, {
    path: LIVE_PATH,
    addTrailingSlash: false,
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (e) => reject(e));
  });
  return socket;
}

const subscribe = (s: Socket, channel: string): Promise<LiveSubscribeAck> =>
  new Promise((resolve) => s.emit(LIVE_EVENTS.subscribe, { channel }, resolve));

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

const get = <T>(url: string) =>
  t
    .http()
    .get(`/api/public/v1${url}`)
    .then((r) => ({ status: r.status, body: r.body as T }));

/** Общее согласие человека на распространение ПДн. */
async function allowPublication(personId: string): Promise<void> {
  const template =
    (await t.admin.consentTemplate.findFirst({
      where: { kind: 'PD_DISTRIBUTION', publishedAt: { not: null } },
    })) ??
    (await t.admin.consentTemplate.create({
      data: {
        id: uuidv7(),
        kind: 'PD_DISTRIBUTION',
        version: 1,
        locale: 'ru',
        operatorName: 'Оператор',
        bodyMarkdown: 'Согласие на распространение',
        publishedAt: new Date(),
      },
    }));
  await t.admin.consent.create({
    data: {
      id: uuidv7(),
      subjectPersonId: personId,
      givenByPersonId: personId,
      templateId: template.id,
      method: 'ELECTRONIC',
      givenAt: new Date(),
    },
  });
}

describe('rating changes of a rated tournament', () => {
  let w: RefereeWorld;
  let slug: string;
  let matches: ScheduledMatch[];

  beforeAll(async () => {
    w = await refereeWorld(t, [{ admitted: 5, format: 'ROUND_ROBIN' }]);
    await t.admin.competition.update({ where: { id: w.competitionId }, data: { competitionType: 'RATED' } });
    await t.admin.competitionRatingConfig.create({
      data: {
        competitionId: w.competitionId,
        ruleSetId: (await t.app.get(RatingRulesService).active())!.id,
      },
    });
    slug = (await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } })).slug;
    matches = (await scheduledMatches(t, w.categories[0]!.categoryId)).filter((m) =>
      m.participants.every((p) => p.entryId && !p.isBye),
    );
  });

  const entryOf = (m: ScheduledMatch, side: 'RED' | 'BLUE') =>
    t.admin.entry.findUniqueOrThrow({
      where: { id: m.participants.find((p) => p.side === side)!.entryId! },
      include: { athlete: { select: { publicId: true, personId: true } } },
    });

  it('tells the public tournament channel and the cache reset channel after each calculation', async () => {
    const viewer = await connect();
    const msgs = record(viewer);
    expect((await subscribe(viewer, liveChannel.publicCompetition(slug))).ok).toBe(true);
    expect((await subscribe(viewer, liveChannel.publicCompetitions)).ok).toBe(true);
    const m = matches.find((x) => x.schedule?.matId === w.mats[0]!.id)!;
    const played = await playToResult(w.refs.chief1.s, m.id, 'RED');
    expect((await confirm(w.refs.chief1.s, played)).status).toBe(200);
    const rated = (x: LiveMessage) =>
      (x.payload as { topics?: string[] }).topics?.includes('rating') ? x : undefined;
    // Подтверждение результата — ещё не рейтинг: расчёт идёт отдельно (worker).
    await new Promise((r) => setTimeout(r, 600));
    expect(msgs.filter(rated)).toEqual([]);

    expect(await t.app.get(RatingCalculationService).calculate(m.id)).toMatchObject({ status: 'COMPLETED' });
    const channel = await waitFor(() =>
      msgs.find((x) => x.channel === liveChannel.publicCompetition(slug) && rated(x)),
    );
    // Публично — только тема, без идентификаторов.
    expect(channel.payload).toEqual({ topics: ['rating'], categoryIds: [], matIds: [], matchIds: [] });
    const reset = await waitFor(() =>
      msgs.find((x) => x.channel === liveChannel.publicCompetitions && rated(x)),
    );
    expect(reset.payload).toEqual({ slug, topics: ['rating'] });
  });

  it('shows the changes publicly: before and after the tournament, every rated match; names by consent', async () => {
    const m = matches.find((x) => x.schedule?.matId === w.mats[0]!.id)!;
    const [red, blue] = await Promise.all([entryOf(m, 'RED'), entryOf(m, 'BLUE')]);
    await allowPublication(red.athlete.personId);

    const page = await get<{ data: PublicCompetition }>(`/competitions/${slug}`);
    expect(page.body.data).toMatchObject({ competitionType: 'RATED', ratingPublic: true });

    const summary = await get<{ data: PublicCompetitionRatingSummary }>(
      `/competitions/${slug}/rating-summary`,
    );
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    // 200 / 200, победа по баллам, K = 30: +12 / −12 (RATING_RULES.md, C8).
    expect(summary.body.data).toEqual({
      calculationVersion: 'sambo-elo@1/elo-1',
      ratedMatches: 1,
      athletes: [
        {
          athlete: {
            publicId: red.athlete.publicId,
            name: red.publicName,
            hidden: false,
            club: red.snapClubName,
            region: null,
          },
          ratingBefore: 200,
          ratingAfter: 212,
          delta: 12,
          levelBefore: 1,
          levelAfter: 1,
          matches: 1,
          wins: 1,
          losses: 0,
        },
        {
          athlete: expect.objectContaining({ publicId: null, name: null, hidden: true }) as unknown,
          ratingBefore: 200,
          ratingAfter: 188,
          delta: -12,
          levelBefore: 1,
          levelAfter: 1,
          matches: 1,
          wins: 0,
          losses: 1,
        },
      ],
    });

    const list = await get<{ data: PublicRatedMatch[] }>(`/competitions/${slug}/rated-matches`);
    expect(list.status).toBe(200);
    const match = await t.admin.match.findUniqueOrThrow({ where: { id: m.id } });
    expect(list.body.data).toEqual([
      {
        matchPublicId: match.publicId,
        matchNumber: match.matchNumber,
        category: expect.objectContaining({ ru: expect.any(String) as unknown }) as unknown,
        finishedAt: expect.any(String) as unknown,
        red: {
          athlete: expect.objectContaining({ name: red.publicName }) as unknown,
          ratingBefore: 200,
          ratingAfter: 212,
          delta: 12,
          levelBefore: 1,
          levelAfter: 1,
          outcome: 'WIN_ON_POINTS',
        },
        blue: {
          athlete: expect.objectContaining({ hidden: true }) as unknown,
          ratingBefore: 200,
          ratingAfter: 188,
          delta: -12,
          levelBefore: 1,
          levelAfter: 1,
          outcome: 'LOSS_ON_POINTS',
        },
      },
    ]);
    expect(blue.athleteId).not.toBe(red.athleteId);
  });

  it('hides the changes when the tournament does not show them publicly, and for a tournament without rating', async () => {
    await t.admin.competitionRatingConfig.update({
      where: { competitionId: w.competitionId },
      data: { publicDeltas: false },
    });
    expect((await get<{ data: PublicCompetition }>(`/competitions/${slug}`)).body.data).toMatchObject({
      competitionType: 'RATED',
      ratingPublic: false,
    });
    for (const path of ['rating-summary', 'rated-matches'])
      expect((await get(`/competitions/${slug}/${path}`)).status).toBe(404);
    await t.admin.competitionRatingConfig.update({
      where: { competitionId: w.competitionId },
      data: { publicDeltas: true },
    });

    const other = await refereeWorld(t, [{ admitted: 3, format: 'ROUND_ROBIN' }]);
    const otherSlug = (await t.admin.competition.findUniqueOrThrow({ where: { id: other.competitionId } }))
      .slug;
    expect((await get<{ data: PublicCompetition }>(`/competitions/${otherSlug}`)).body.data).toMatchObject({
      competitionType: 'NON_RATED',
      ratingPublic: false,
    });
    expect((await get(`/competitions/${otherSlug}/rating-summary`)).status).toBe(404);
  });
});
