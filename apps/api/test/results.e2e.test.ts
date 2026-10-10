// Итоги (Phase 7b; план §7): завершение категории последним подтверждением (и автоматическими неявками), места и
// медали, публикация (права, RESULT_NOT_CONFIRMED, история спортсмена), изменение подтверждённого результата
// (права, прежние варианты, пересчёт сетки и мест, DEPENDENT_MATCHES_STARTED, возврат категории в «идут схватки»,
// обновление истории), гонка подтверждения и изменения, врач на ковре, перенос и отмена, ручная схватка,
// протоколы, завершение турнира, журнал синхронизации, прежние варианты только дополняются.
import type {
  AthleteHistoryDto,
  BracketNodeDto,
  CategoryBracketDto,
  CategoryProtocolDto,
  CategoryResultsDto,
  CompetitionResultsDto,
  MatchDetailDto,
  MatchProtocolDto,
  MatQueueDto,
  MedicalIncidentDto,
} from '@sde/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp, createUser, login, resetData, type Session, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import {
  confirm,
  event,
  getMatch,
  official,
  playToResult,
  refereeWorld,
  type RefereeWorld,
  scheduledMatches,
  transition,
} from './helpers/phase7';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

async function nodes(s: Session, categoryId: string): Promise<BracketNodeDto[]> {
  const r = await s.agent.get(`/api/v1/categories/${categoryId}/brackets`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body.data as CategoryBracketDto).bracket?.nodes ?? [];
}

async function results(s: Session, categoryId: string): Promise<CategoryResultsDto> {
  const r = await s.agent.get(`/api/v1/categories/${categoryId}/results`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as CategoryResultsDto;
}

const categoryStatus = async (categoryId: string) =>
  (await t.admin.competitionCategory.findUniqueOrThrow({ where: { id: categoryId } })).status;

/** Сыграть и подтвердить схватку узла: победитель — сторона `winner`. */
async function decide(
  s: Session,
  node: BracketNodeDto | undefined,
  winner: 'RED' | 'BLUE',
): Promise<MatchDetailDto> {
  const played = await playToResult(s, node!.match!.id, winner);
  const r = await confirm(s, played);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as MatchDetailDto;
}

function amend(s: Session, m: { id: string; version: number }, body: Record<string, unknown>) {
  return send(s, 'post', `/api/v1/matches/${m.id}/result/amend`, body, m.version);
}

/** Руководитель клуба спортсмена участия — видит его карточку и историю. */
async function clubManagerOf(entryId: string): Promise<Session> {
  const entry = await t.admin.entry.findUniqueOrThrow({ where: { id: entryId } });
  const membership = await t.admin.athleteMembership.findFirstOrThrow({
    where: { athleteId: entry.athleteId },
  });
  const user = await createUser(t, {
    orgs: [{ organizationId: membership.organizationId, role: 'CLUB_MANAGER' }],
  });
  return login(t, user.email);
}

describe('a category from the last confirmation to the athlete history', () => {
  let w: RefereeWorld;
  let categoryId: string;
  let finalId: string;

  beforeAll(async () => {
    w = await refereeWorld(t, [{ admitted: 4, format: 'SINGLE_ELIMINATION' }]);
    categoryId = w.categories[0]!.categoryId;
  });

  it('completes the category with the last confirmed result: places 1, 2, 3, 3 with medals', async () => {
    const chief = w.staff.chief;
    const semis = (await nodes(chief, categoryId)).filter((n) => n.label === 'SEMIFINAL');
    await decide(chief, semis[0], 'RED');
    await decide(chief, semis[1], 'BLUE');
    expect(await categoryStatus(categoryId)).toBe('IN_PROGRESS');
    let r = await results(chief, categoryId);
    expect(r).toMatchObject({ status: null, matchesTotal: 3, matchesDecided: 2, canPublish: false });
    const final = (await nodes(chief, categoryId)).find((n) => n.label === 'FINAL')!;
    finalId = final.match!.id;
    const played = await playToResult(chief, finalId, 'RED');
    r = await results(chief, categoryId);
    expect(r).toMatchObject({ awaitingConfirmation: 1, status: null });
    expect((await confirm(chief, played)).status).toBe(200);
    expect(await categoryStatus(categoryId)).toBe('COMPLETED');
    r = await results(chief, categoryId);
    expect(r).toMatchObject({ status: 'PROVISIONAL', matchesDecided: 3, canPublish: true });
    expect(r.placements.map((p) => [p.place, p.medal])).toEqual([
      [1, 'GOLD'],
      [2, 'SILVER'],
      [3, 'BRONZE'],
      [3, 'BRONZE'],
    ]);
    expect(r.placements[0]?.entryId).toBe(final.red.entryId);
    expect(r.placements[0]).toMatchObject({ wins: 2, losses: 0 });
    expect(
      await t.admin.outboxEvent.count({ where: { type: 'category.completed', aggregateId: categoryId } }),
    ).toBe(1);
    // Судья видит итоги, но опубликовать не может.
    const judge = await official(t, w.competitionId);
    expect((await results(judge.s, categoryId)).canPublish).toBe(false);
  });

  it('publishes only with the right, the current version and every result confirmed', async () => {
    const r = await results(w.staff.chief, categoryId);
    const judge = await official(t, w.competitionId);
    const denied = await send(
      judge.s,
      'post',
      `/api/v1/categories/${categoryId}/results/publish`,
      {},
      r.version,
    );
    expect(denied.status).toBe(403);
    const stale = await send(
      w.staff.chief,
      'post',
      `/api/v1/categories/${categoryId}/results/publish`,
      {},
      r.version - 1,
    );
    expect(stale.status).toBe(409);
    const ok = await send(
      w.staff.manager,
      'post',
      `/api/v1/categories/${categoryId}/results/publish`,
      {},
      r.version,
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'PUBLISHED', categoryStatus: 'RESULTS_PUBLISHED' });
    const statuses = await t.admin.matchResult.groupBy({
      by: ['status'],
      where: { match: { categoryId } },
      _count: true,
    });
    expect(statuses.map((s) => s.status)).toEqual(['PUBLISHED']);
    expect(await t.admin.athleteResult.count({ where: { categoryId } })).toBe(4);
    const again = await send(
      w.staff.manager,
      'post',
      `/api/v1/categories/${categoryId}/results/publish`,
      {},
      r.version + 1,
    );
    expect(again.status).toBe(422);
    expect(
      await t.admin.outboxEvent.count({
        where: { type: 'category.results_published', aggregateId: categoryId },
      }),
    ).toBe(1);
  });

  it('shows the result in the athlete history to the club, not to strangers', async () => {
    const r = await results(w.staff.chief, categoryId);
    const champion = r.placements[0]!;
    const athleteId = (await t.admin.entry.findUniqueOrThrow({ where: { id: champion.entryId } })).athleteId;
    const club = await clubManagerOf(champion.entryId);
    const h = await club.agent.get(`/api/v1/athletes/${athleteId}/history`);
    expect(h.status, JSON.stringify(h.body)).toBe(200);
    const history = h.body.data as AthleteHistoryDto;
    expect(history.summary).toMatchObject({ competitions: 1, matches: 2, wins: 2, losses: 0 });
    expect(history.summary.medals).toEqual({ GOLD: 1, SILVER: 0, BRONZE: 0 });
    expect(history.results[0]).toMatchObject({ place: 1, medal: 'GOLD', status: 'PUBLISHED' });
    const stranger = await w.staff.outsider.agent.get(`/api/v1/athletes/${athleteId}/history`);
    expect(stranger.status).toBe(404);
  });

  it('amends a published final with a reason: revision, places swapped, history updated', async () => {
    const m = await getMatch(w.staff.chief, finalId);
    expect(m.allowedActions).toContain('result.amend');
    const judge = await official(t, w.competitionId);
    expect(
      (await amend(judge.s, m, { winnerSide: 'BLUE', method: 'POINTS', reason: 'Ошибка табло' })).status,
    ).toBe(403);
    const noReason = await amend(w.staff.chief, m, { winnerSide: 'BLUE', method: 'POINTS' });
    expect(noReason.status).toBe(400);
    const r = await amend(w.staff.chief, m, {
      winnerSide: 'BLUE',
      method: 'DECISION',
      reason: 'Ошибка подсчёта предупреждения',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = r.body.data as MatchDetailDto;
    expect(after.result).toMatchObject({ status: 'AMENDED', winnerSide: 'BLUE', method: 'DECISION' });
    expect(after.revisions).toHaveLength(1);
    expect(after.revisions[0]).toMatchObject({ revision: 1, winnerSide: 'RED', status: 'PUBLISHED' });
    const res = await results(w.staff.chief, categoryId);
    expect(res.status).toBe('AMENDED');
    expect(res.placements[0]?.entryId).toBe(after.blue.entryId);
    const history = await t.admin.athleteResult.findUniqueOrThrow({
      where: { entryId: after.blue.entryId! },
    });
    expect(history).toMatchObject({ place: 1, medal: 'GOLD', status: 'AMENDED' });
    // Прежние варианты только дополняются.
    const db = t.app.get(PrismaService);
    await expect(db.$executeRaw`UPDATE match_result_revision SET reason = 'xxxxx'`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM match_result_revision`).rejects.toThrow();
    const tables = await t.admin.syncLog.groupBy({
      by: ['tableName'],
      where: {
        competitionId: w.competitionId,
        tableName: { in: ['category_result', 'placement', 'athlete_result', 'match_result_revision'] },
      },
    });
    expect(tables.map((x) => x.tableName).sort()).toEqual([
      'athlete_result',
      'category_result',
      'match_result_revision',
      'placement',
    ]);
  });

  it('refuses to amend a semifinal once the final is played: DEPENDENT_MATCHES_STARTED with the list', async () => {
    const semi = (await nodes(w.staff.chief, categoryId)).find((n) => n.label === 'SEMIFINAL')!;
    const m = await getMatch(w.staff.chief, semi.match!.id);
    const r = await amend(w.staff.chief, m, {
      winnerSide: m.result!.winnerSide === 'RED' ? 'BLUE' : 'RED',
      method: 'POINTS',
      reason: 'Пересмотр по видео',
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('DEPENDENT_MATCHES_STARTED');
    expect(r.body.error.details.matchIds).toEqual([finalId]);
    expect((await getMatch(w.staff.chief, m.id)).revisions).toEqual([]);
  });
});

describe('amendments that move the bracket', () => {
  it('re-routes the final when a semifinal is amended before the final is played', async () => {
    const w = await refereeWorld(t, [{ admitted: 4, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const semi = (await nodes(chief, categoryId)).find((n) => n.label === 'SEMIFINAL')!;
    const decided = await decide(chief, semi, 'RED');
    const r = await amend(chief, decided, {
      winnerSide: 'BLUE',
      method: 'POINTS',
      reason: 'Ошибка ввода стороны',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const final = (await nodes(chief, categoryId)).find((n) => n.label === 'FINAL')!;
    expect([final.red.entryId, final.blue.entryId]).toContain(semi.blue.entryId);
    expect([final.red.entryId, final.blue.entryId]).not.toContain(semi.red.entryId);
  });

  it('recomputes an automatic no-show and reopens a completed category', async () => {
    const w = await refereeWorld(t, [{ admitted: 4, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const [s1, s2] = (await nodes(chief, categoryId)).filter((n) => n.label === 'SEMIFINAL');
    const first = await decide(chief, s1, 'RED');
    // Победитель первого полуфинала снят: финал — неявка, категория завершена без схватки финала.
    const winner = await t.admin.entry.findUniqueOrThrow({ where: { id: s1!.red.entryId! } });
    const wd = await send(
      w.staff.manager,
      'post',
      `/api/v1/entries/${winner.id}/withdraw`,
      { reason: 'Травма на разминке' },
      winner.version,
    );
    expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    await decide(chief, s2, 'RED');
    expect(await categoryStatus(categoryId)).toBe('COMPLETED');
    expect((await results(chief, categoryId)).placements[0]?.entryId).toBe(s2!.red.entryId);
    const completedOnce = await results(chief, categoryId);
    // Первый полуфинал исправлен: в финал выходит неснятый — финал снова настоящая схватка, категория открыта.
    const m = await getMatch(chief, first.id);
    const r = await amend(chief, m, { winnerSide: 'BLUE', method: 'POINTS', reason: 'Пересмотр по видео' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const final = (await nodes(chief, categoryId)).find((n) => n.label === 'FINAL')!;
    expect(final).toMatchObject({ status: 'READY', match: { status: 'SCHEDULED', result: null } });
    expect(await categoryStatus(categoryId)).toBe('IN_PROGRESS');
    expect((await results(chief, categoryId)).status).toBeNull();
    // Финал сыгран и подтверждён — категория снова завершена; версия итогов не повторяется: публикация по
    // итогам, которые видели до изменения, — конфликт версии.
    await decide(chief, final, 'BLUE');
    expect(await categoryStatus(categoryId)).toBe('COMPLETED');
    const again = await results(chief, categoryId);
    expect(again.version).toBeGreaterThan(completedOnce.version);
    const stale = await send(
      chief,
      'post',
      `/api/v1/categories/${categoryId}/results/publish`,
      {},
      completedOnce.version,
    );
    expect(stale.status).toBe(409);
  });

  it('publishes the outcomes the system recomputes after an amendment of a published category', async () => {
    const w = await refereeWorld(t, [{ admitted: 4, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const [s1, s2] = (await nodes(chief, categoryId)).filter((n) => n.label === 'SEMIFINAL');
    const first = await decide(chief, s1, 'RED');
    // Оба участника первого полуфинала сняты после него: финал решается неявкой автоматически.
    for (const entryId of [s1!.red.entryId!, s1!.blue.entryId!]) {
      const e = await t.admin.entry.findUniqueOrThrow({ where: { id: entryId } });
      const wd = await send(
        w.staff.manager,
        'post',
        `/api/v1/entries/${entryId}/withdraw`,
        { reason: 'Травма на разминке' },
        e.version,
      );
      expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    }
    await decide(chief, s2, 'RED');
    expect(await categoryStatus(categoryId)).toBe('COMPLETED');
    const r0 = await results(chief, categoryId);
    const pub = await send(chief, 'post', `/api/v1/categories/${categoryId}/results/publish`, {}, r0.version);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    // Изменён первый полуфинал: в финал выходит другой снятый — неявка пересчитана и тоже опубликована.
    const amended = await amend(chief, await getMatch(chief, first.id), {
      winnerSide: 'BLUE',
      method: 'POINTS',
      reason: 'Пересмотр по видео',
    });
    expect(amended.status, JSON.stringify(amended.body)).toBe(200);
    expect(await categoryStatus(categoryId)).toBe('RESULTS_PUBLISHED');
    const final = (await nodes(chief, categoryId)).find((n) => n.label === 'FINAL')!;
    const finalResult = await t.admin.matchResult.findUniqueOrThrow({ where: { matchId: final.match!.id } });
    expect(finalResult).toMatchObject({ status: 'PUBLISHED', method: 'NO_SHOW' });
    expect(final.red.entryId ?? final.blue.entryId).toBeTruthy();
    const after = await results(chief, categoryId);
    expect(after.status).toBe('AMENDED');
    const second = after.placements.find((p) => p.place === 2);
    expect(second?.entryId).toBe(s1!.blue.entryId);
    expect(await t.admin.matchResult.count({ where: { status: 'CONFIRMED', match: { categoryId } } })).toBe(
      0,
    );
  });

  it('confirming the last match and amending another at the same moment leave consistent results', async () => {
    const w = await refereeWorld(t, [{ admitted: 3 }]);
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const [m1, m2, m3] = await scheduledMatches(t, categoryId);
    const d1 = await confirm(chief, await playToResult(chief, m1!.id, 'RED'));
    await confirm(chief, await playToResult(chief, m2!.id, 'RED'));
    const last = await playToResult(chief, m3!.id, 'BLUE');
    const first = d1.body.data as MatchDetailDto;
    const [c, a] = await Promise.all([
      confirm(chief, last),
      amend(chief, first, { winnerSide: 'RED', method: 'TOTAL_VICTORY', reason: 'Бросок был чистым' }),
    ]);
    expect([c.status, a.status], JSON.stringify([c.body, a.body])).toEqual([200, 200]);
    expect(await categoryStatus(categoryId)).toBe('COMPLETED');
    const r = await results(chief, categoryId);
    expect(r.placements).toHaveLength(3);
    const stored = await t.admin.placement.count({ where: { categoryResult: { categoryId } } });
    expect(stored).toBe(3);
  });
});

describe('doctor on the mat', () => {
  it('records help privately and withdraws an athlete: injury, remaining matches by no-show', async () => {
    const w = await refereeWorld(t, [{ admitted: 3 }]);
    const categoryId = w.categories[0]!.categoryId;
    const chief = w.staff.chief;
    const doctor = await official(t, w.competitionId, 'MEDICAL_STAFF');
    const [m1] = await scheduledMatches(t, categoryId);
    let d = (await transition(chief, m1!, 'READY')).body.data as MatchDetailDto;
    d = (await transition(chief, d, 'IN_PROGRESS')).body.data as MatchDetailDto;
    await event(chief, d.id, { type: 'CLOCK_STARTED', expectedSeq: 0 });
    const help = { side: 'BLUE', kind: 'ASSISTANCE', decision: 'CONTINUE', note: 'Обработка ссадины' };
    expect((await send(chief, 'post', `/api/v1/matches/${d.id}/medical-incidents`, help)).status).toBe(403);
    const ok = await send(doctor.s, 'post', `/api/v1/matches/${d.id}/medical-incidents`, help);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const seen = await getMatch(chief, d.id);
    expect(seen.incidents).toHaveLength(1);
    expect(seen.incidents[0]).toMatchObject({ side: 'BLUE', kind: 'ASSISTANCE', note: null });
    expect((await chief.agent.get(`/api/v1/matches/${d.id}/medical-incidents`)).status).toBe(403);
    const list = await doctor.s.agent.get(`/api/v1/matches/${d.id}/medical-incidents`);
    expect((list.body.data as MedicalIncidentDto[])[0]?.note).toBe('Обработка ссадины');
    expect(await t.admin.dataAccessLog.count({ where: { resourceType: 'MedicalIncident' } })).toBeGreaterThan(
      0,
    );
    // Снятие врачом: «травма», победитель — соперник, участие снято, оставшаяся схватка снятого — неявка.
    // Снятие завершает схватку — только при остановленном времени (как запись результата).
    const injured = seen.blue.entryId!;
    const withdraw = { side: 'BLUE', kind: 'STOPPAGE', decision: 'WITHDRAWN_BY_DOCTOR' };
    const running = await send(doctor.s, 'post', `/api/v1/matches/${d.id}/medical-incidents`, withdraw);
    expect(running.status).toBe(422);
    expect(running.body.error.details.failed).toEqual(['clock_running']);
    const stopped = await event(chief, d.id, {
      type: 'CLOCK_STOPPED',
      matchClockMs: 42_000,
      expectedSeq: seen.seq,
    });
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(201);
    const stop = await send(doctor.s, 'post', `/api/v1/matches/${d.id}/medical-incidents`, withdraw);
    expect(stop.status, JSON.stringify(stop.body)).toBe(201);
    expect(stop.body.data).toMatchObject({
      status: 'FINISHED',
      result: { status: 'PROVISIONAL', method: 'INJURY', winnerSide: 'RED' },
    });
    const entry = await t.admin.entry.findUniqueOrThrow({ where: { id: injured } });
    expect(entry).toMatchObject({
      status: 'WITHDRAWN',
      activeMatchId: null,
      withdrawReason: 'withdrawn_by_doctor',
    });
    const others = await t.admin.match.findMany({
      where: { categoryId, id: { not: d.id }, participants: { some: { entryId: injured } } },
      include: { result: true },
    });
    expect(others.map((m) => [m.status, m.result?.method])).toEqual([['FINISHED', 'NO_SHOW']]);
    // Запись врача — операционные данные турнира (DATABASE.md, 7): в журнале синхронизации, только вставка.
    expect(
      await t.admin.syncLog.count({
        where: { competitionId: w.competitionId, tableName: 'medical_incident', op: 'INSERT' },
      }),
    ).toBe(2);
    const db = t.app.get(PrismaService);
    await expect(db.$executeRaw`UPDATE medical_incident SET note = 'x'`).rejects.toThrow();
  });
});

describe('postpone, cancel and a manual match', () => {
  let w: RefereeWorld;
  let categoryId: string;

  beforeAll(async () => {
    w = await refereeWorld(t, [{ admitted: 3 }]);
    categoryId = w.categories[0]!.categoryId;
  });

  it('postpones with a reason, skips the match in the queue and returns it', async () => {
    const [m] = await scheduledMatches(t, categoryId);
    const chief = w.staff.chief;
    const noReason = await transition(chief, m!, 'POSTPONED');
    expect(noReason.status).toBe(400);
    const p = await transition(chief, m!, 'POSTPONED', 'Спортсмен у врача');
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const postponed = p.body.data as MatchDetailDto;
    expect(postponed.status).toBe('POSTPONED');
    const q = await chief.agent.get(`/api/v1/mats/${m!.schedule!.matId}/queue`);
    const queue = q.body.data as MatQueueDto;
    expect([queue.current?.matchId, ...queue.next.map((x) => x.matchId)]).not.toContain(m!.id);
    expect((await transition(chief, postponed, 'READY')).status).toBe(422);
    const back = await transition(chief, postponed, 'SCHEDULED');
    expect(back.status).toBe(200);
    expect((back.body.data as MatchDetailDto).status).toBe('SCHEDULED');
    const cancel = await transition(
      chief,
      back.body.data as MatchDetailDto,
      'CANCELLED',
      'Отмена без причины',
    );
    expect(cancel.status).toBe(422);
    expect(cancel.body.error.details.failed).toEqual(['bracket_match']);
  });

  it('adds a manual match at the end of the mat; it is played and cancelled like any other, places ignore it', async () => {
    const entries = w.categories[0]!.entries;
    const judge = await official(t, w.competitionId);
    const body = {
      redEntryId: entries[0],
      blueEntryId: entries[1],
      label: 'Переигровка',
      durationSeconds: 120,
      matId: w.mats[0]!.id,
      sessionId: w.session.id,
    };
    expect((await send(judge.s, 'post', `/api/v1/categories/${categoryId}/matches`, body)).status).toBe(403);
    // Экраны: кнопка «Добавить схватку» — по праву match.create, протоколы и публикация — в правах турнира.
    const office = async (s: Session) =>
      (await s.agent.get(`/api/v1/competitions/${w.competitionId}/officiating`)).body.data as {
        canCreateMatch: boolean;
      };
    expect((await office(judge.s)).canCreateMatch).toBe(false);
    expect((await office(w.staff.secretary)).canCreateMatch).toBe(true);
    const actions = async (s: Session) =>
      (
        (await s.agent.get(`/api/v1/competitions/${w.competitionId}`)).body.data as {
          allowedActions: string[];
        }
      ).allowedActions;
    expect(await actions(w.staff.chief)).toEqual(
      expect.arrayContaining(['result.publish', 'result.amend', 'export.create']),
    );
    expect(await actions(w.staff.secretary)).toEqual(
      expect.arrayContaining(['match.create', 'export.create']),
    );
    expect(await actions(w.staff.secretary)).not.toContain('result.amend');
    const created = await send(w.staff.secretary, 'post', `/api/v1/categories/${categoryId}/matches`, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const m = created.body.data as MatchDetailDto;
    expect(m).toMatchObject({
      manual: true,
      roundLabel: 'Переигровка',
      status: 'SCHEDULED',
      durationSeconds: 120,
    });
    expect(m.number).toBeGreaterThan(0);
    const slots = await t.admin.matchSchedule.findMany({
      where: { sessionId: w.session.id, matId: w.mats[0]!.id },
      orderBy: { orderInMat: 'asc' },
    });
    expect(slots.at(-1)?.matchId).toBe(m.id);
    const second = await send(w.staff.secretary, 'post', `/api/v1/categories/${categoryId}/matches`, {
      ...body,
      label: 'Показательная',
    });
    const cancelled = await transition(
      w.staff.manager,
      second.body.data as MatchDetailDto,
      'CANCELLED',
      'Не состоится',
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect((cancelled.body.data as MatchDetailDto).status).toBe('CANCELLED');
    // Сетка решена — категория завершена, ручная схватка на места не влияет и может быть сыграна потом.
    for (const sm of (await scheduledMatches(t, categoryId)).filter((x) => x.bracketNodeId !== null))
      await confirm(w.staff.chief, await playToResult(w.staff.chief, sm.id, 'RED'));
    expect(await categoryStatus(categoryId)).toBe('COMPLETED');
    await confirm(w.staff.chief, await playToResult(w.staff.chief, m.id, 'BLUE'));
    expect((await results(w.staff.chief, categoryId)).placements).toHaveLength(3);
  });

  it('prints protocols with full names for the office, not for a judge', async () => {
    const [m] = (await scheduledMatches(t, categoryId)).filter((x) => x.bracketNodeId !== null);
    const judge = await official(t, w.competitionId);
    expect((await judge.s.agent.get(`/api/v1/matches/${m!.id}/protocol`)).status).toBe(403);
    const r = await w.staff.secretary.agent.get(`/api/v1/matches/${m!.id}/protocol`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = r.body.data as MatchProtocolDto;
    expect(p.red?.fullName.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(p.events.map((e) => e.type)).toEqual(['CLOCK_STARTED', 'SCORE', 'CLOCK_STOPPED']);
    expect(p.durationSeconds).toBeGreaterThan(0);
    expect(p.events[2]?.matchClockMs).toBe((p.durationSeconds ?? 0) * 1000);
    expect(p.events[1]).toMatchObject({ points: 4, pointsTo: 'RED', red: 4, blue: 0 });
    expect(p.result).toMatchObject({ winnerSide: 'RED', method: 'POINTS' });
    const c = await w.staff.secretary.agent.get(`/api/v1/categories/${categoryId}/protocol`);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const cp = c.body.data as CategoryProtocolDto;
    expect(cp.places).toHaveLength(3);
    expect(cp.places.map((x) => x.place)).toEqual([...cp.places.map((x) => x.place)].sort((a, b) => a - b));
    expect(cp.matches.some((x) => x.roundLabel === 'Переигровка')).toBe(true);
    expect(
      await t.admin.dataAccessLog.count({
        where: { resourceType: { in: ['MatchProtocol', 'CategoryProtocol'] } },
      }),
    ).toBe(2);
  });
});

describe('finishing the competition', () => {
  it('requires published results of every drawn category', async () => {
    const w = await refereeWorld(t, [{ admitted: 2 }]);
    const categoryId = w.categories[0]!.categoryId;
    const [m] = await scheduledMatches(t, categoryId);
    await confirm(w.staff.chief, await playToResult(w.staff.chief, m!.id, 'RED'));
    const finish = async () => {
      const c = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
      return send(
        w.staff.manager,
        'post',
        `/api/v1/competitions/${w.competitionId}/transitions`,
        { to: 'FINISHED' },
        c.version,
      );
    };
    const early = await finish();
    expect(early.status).toBe(422);
    expect(early.body.error.details.failed).toContain('results_not_published');
    const r = await results(w.staff.chief, categoryId);
    expect(
      (await send(w.staff.chief, 'post', `/api/v1/categories/${categoryId}/results/publish`, {}, r.version))
        .status,
    ).toBe(200);
    const overview = await w.staff.manager.agent.get(`/api/v1/competitions/${w.competitionId}/results`);
    expect(overview.body.data as CompetitionResultsDto).toMatchObject({
      allPublished: true,
      canFinish: true,
    });
    const done = await finish();
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } })).status).toBe(
      'FINISHED',
    );
  });
});
