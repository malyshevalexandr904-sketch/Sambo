// Судейство (Phase 7a; план §9): схватка от вызова до подтверждённого результата и продвижения сетки; журнал
// событий (идемпотентность, expectedSeq, отмена, append-only), права бригады (MAT_ASSIGNED, MAT_CHIEF), гонка двух
// стартов со спортсменом в двух схватках, завершение без результата, неявки снятых участников по цепочке,
// одновременные подтверждения на двух коврах, экран «Ковры», планшет, журнал синхронизации.
// Отказ команд при праве записи у площадочного узла — route-security.e2e.test.ts (по всем маршрутам [L]).
import type {
  BracketNodeDto,
  CategoryBracketDto,
  MatchDetailDto,
  MatchEventResultDto,
  MatConsoleDto,
  MatQueueDto,
  OfficiatingDto,
  PendingConfirmationDto,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp, resetData, type Session, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import {
  confirm,
  event,
  getMatch,
  playToResult,
  refereeWorld,
  type RefereeWorld,
  scheduledMatches,
  transition,
  voidEvent,
} from './helpers/phase7';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

async function bracketNodes(s: Session, categoryId: string): Promise<BracketNodeDto[]> {
  const r = await s.agent.get(`/api/v1/categories/${categoryId}/brackets`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body.data as CategoryBracketDto).bracket?.nodes ?? [];
}

/** Первая схватка категории на ковре 1 с известными участниками (полуфинал олимпийской системы на 4). */
async function firstOnMat(w: RefereeWorld, categoryId: string) {
  const all = await scheduledMatches(t, categoryId);
  const ready = all.filter((m) => m.participants.every((p) => p.entryId !== null));
  return { all, ready };
}

describe('a match on the mat: call, start, score, result, confirmation, bracket', () => {
  let w: RefereeWorld;
  let matchId: string;
  let categoryId: string;

  beforeAll(async () => {
    w = await refereeWorld(t, [{ admitted: 4, format: 'SINGLE_ELIMINATION' }]);
    categoryId = w.categories[0]!.categoryId;
    // Категория целиком на одном ковре; бригада руководителя — на ковре 1. Ставим схватки категории на ковёр 1.
    await t.admin.matchSchedule.updateMany({
      where: { match: { categoryId } },
      data: { matId: w.mats[0]!.id },
    });
    const { ready } = await firstOnMat(w, categoryId);
    matchId = ready[0]!.id;
  });

  it('only the mat crew, the chief referee and the tournament office can call the pair', async () => {
    let m = await getMatch(w.refs.judge1.s, matchId);
    expect(m.allowedActions).toEqual(expect.arrayContaining(['transition:READY', 'no_show']));
    // Судья без назначения на этот ковёр в этой сессии — 403.
    const idle = await transition(w.refs.idle.s, m, 'READY');
    expect(idle.status).toBe(403);
    const otherMat = await transition(w.refs.judge2.s, m, 'READY');
    expect(otherMat.status).toBe(403);
    // Секретарь вызывает пары и отменяет вызов (match.update), но не стартует схватку.
    const called = await transition(w.staff.secretary, m, 'READY');
    expect(called.status, JSON.stringify(called.body)).toBe(200);
    m = called.body.data as MatchDetailDto;
    expect(m.status).toBe('READY');
    const start = await transition(w.staff.secretary, m, 'IN_PROGRESS');
    expect(start.status).toBe(403);
    const cancel = await transition(w.staff.secretary, m, 'SCHEDULED');
    expect(cancel.status).toBe(200);
    m = cancel.body.data as MatchDetailDto;
    const stale = await transition(w.refs.judge1.s, { id: matchId, version: m.version - 1 }, 'READY');
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const again = await transition(w.refs.judge1.s, m, 'READY');
    expect(again.status).toBe(200);
  });

  it('starts: athletes are on the mat, the competition and the category go in progress', async () => {
    const m = await getMatch(w.refs.judge1.s, matchId);
    const r = await transition(w.refs.judge1.s, m, 'IN_PROGRESS');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const started = r.body.data as MatchDetailDto;
    expect(started).toMatchObject({ status: 'IN_PROGRESS', seq: 0, mat: { id: w.mats[0]!.id } });
    expect(started.state).toMatchObject({ red: { points: 0 }, blue: { points: 0 }, durationMs: 180_000 });
    expect(started.startedAt).not.toBeNull();
    const entries = await t.admin.entry.findMany({
      where: { id: { in: [started.red.entryId!, started.blue.entryId!] } },
    });
    expect(entries.every((e) => e.activeMatchId === matchId)).toBe(true);
    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    expect(competition.status).toBe('IN_PROGRESS');
    const category = await t.admin.competitionCategory.findUniqueOrThrow({ where: { id: categoryId } });
    expect(category.status).toBe('IN_PROGRESS');
    expect(await t.admin.outboxEvent.count({ where: { type: 'match.started', aggregateId: matchId } })).toBe(
      1,
    );
  });

  it('records events with idempotency keys and expected sequence numbers', async () => {
    const s = w.refs.judge1.s;
    const clock = await event(s, matchId, { type: 'CLOCK_STARTED', expectedSeq: 0 });
    expect(clock.status, JSON.stringify(clock.body)).toBe(201);
    const key = randomUUID();
    const body = { type: 'SCORE', side: 'RED', actionCode: 'THROW_4', expectedSeq: 1, matchClockMs: 20_000 };
    const first = await event(s, matchId, body, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const scored = first.body.data as MatchEventResultDto;
    expect(scored.state.red.points).toBe(4);
    expect(scored.seq).toBe(2);
    // Повтор той же команды с тем же ключом — без дубля.
    const repeat = await event(s, matchId, body, key);
    expect(repeat.status).toBe(201);
    expect((repeat.body.data as MatchEventResultDto).event.id).toBe(scored.event.id);
    expect(await t.admin.matchEvent.count({ where: { matchId } })).toBe(2);
    // Второй планшет по устаревшему состоянию — конфликт.
    const stale = await event(s, matchId, {
      type: 'PENALTY',
      side: 'BLUE',
      expectedSeq: 1,
      matchClockMs: 25_000,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'EXPECTED_SEQ_MISMATCH', details: { currentSeq: 2 } });
    // Действия не из правил турнира отклоняются.
    const unknown = await event(s, matchId, {
      type: 'SCORE',
      side: 'BLUE',
      actionCode: 'THROW_3',
      expectedSeq: 2,
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toMatchObject({
      code: 'EVENT_NOT_ALLOWED_BY_RULESET',
      details: { reason: 'unknown_action' },
    });
    // Наказание — следующее по порядку правил; баллы сопернику.
    for (const [seq, clockMs] of [
      [2, 30_000],
      [3, 40_000],
    ] as const) {
      const p = await event(s, matchId, {
        type: 'PENALTY',
        side: 'BLUE',
        expectedSeq: seq,
        matchClockMs: clockMs,
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
    }
    let m = await getMatch(s, matchId);
    expect(m.state?.blue.penalties).toEqual(['REMARK', 'WARNING_1']);
    expect(m.state?.red.points).toBe(5);
    // Удержание 10 с — 2 балла; отмена последнего события отменяет удержание целиком.
    await event(s, matchId, { type: 'HOLD_STARTED', side: 'RED', expectedSeq: 4, matchClockMs: 60_000 });
    const ended = await event(s, matchId, {
      type: 'HOLD_ENDED',
      side: 'RED',
      value: 12_000,
      expectedSeq: 5,
      matchClockMs: 72_000,
    });
    expect((ended.body.data as MatchEventResultDto).state.red.points).toBe(7);
    const undo = await voidEvent(s, matchId, (ended.body.data as MatchEventResultDto).event.id, 6);
    expect(undo.status, JSON.stringify(undo.body)).toBe(201);
    expect((undo.body.data as MatchEventResultDto).state.red).toMatchObject({ points: 5, holds: 0 });
    m = await getMatch(s, matchId);
    expect(m.seq).toBe(7);
    const log = await s.agent.get(`/api/v1/matches/${matchId}/events?afterSeq=4`);
    expect(log.status).toBe(200);
    expect(log.body.data.events.map((e: { type: string; voided: boolean }) => [e.type, e.voided])).toEqual([
      ['HOLD_STARTED', true],
      ['HOLD_ENDED', true],
      ['EVENT_VOIDED', false],
    ]);
  });

  it('a judge without assignment cannot score; the secretary cannot score', async () => {
    const m = await getMatch(w.refs.judge1.s, matchId);
    for (const s of [w.refs.idle.s, w.staff.secretary, w.staff.manager]) {
      const r = await event(s, matchId, {
        type: 'SCORE',
        side: 'BLUE',
        actionCode: 'THROW_1',
        expectedSeq: m.seq,
      });
      expect(r.status).toBe(403);
    }
  });

  it('finishes only with a provisional result; the server proposes the outcome', async () => {
    const s = w.refs.judge1.s;
    let m = await getMatch(s, matchId);
    const finish = await transition(s, m, 'FINISHED');
    expect(finish.status).toBe(422);
    expect(finish.body.error.code).toBe('MATCH_RESULT_INCOMPLETE');
    const running = await send(
      s,
      'post',
      `/api/v1/matches/${matchId}/result`,
      { expectedSeq: m.seq, winnerSide: 'RED', method: 'POINTS' },
      m.version,
    );
    expect(running.status).toBe(422);
    expect(running.body.error.details.failed).toEqual(['clock_running']);
    const stop = await event(s, matchId, {
      type: 'CLOCK_STOPPED',
      expectedSeq: m.seq,
      matchClockMs: 180_000,
    });
    expect((stop.body.data as MatchEventResultDto).proposedOutcome).toMatchObject({
      winnerSide: 'RED',
      method: 'POINTS',
      basis: 'POINTS',
    });
    m = await getMatch(s, matchId);
    const other = await send(
      s,
      'post',
      `/api/v1/matches/${matchId}/result`,
      { expectedSeq: m.seq, winnerSide: 'BLUE', method: 'DECISION' },
      m.version,
    );
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('REASON_REQUIRED');
    const ok = await send(
      s,
      'post',
      `/api/v1/matches/${matchId}/result`,
      { expectedSeq: m.seq, winnerSide: 'RED', method: 'POINTS' },
      m.version,
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    m = ok.body.data as MatchDetailDto;
    expect(m).toMatchObject({
      status: 'FINISHED',
      result: { status: 'PROVISIONAL', winnerSide: 'RED', method: 'POINTS', redScore: 5, blueScore: 0 },
    });
    // Участники свободны; схватка завершена — события больше не принимаются.
    const entries = await t.admin.entry.findMany({
      where: { id: { in: [m.red.entryId!, m.blue.entryId!] } },
    });
    expect(entries.every((e) => e.activeMatchId === null)).toBe(true);
    const late = await event(s, matchId, {
      type: 'SCORE',
      side: 'BLUE',
      actionCode: 'THROW_1',
      expectedSeq: m.seq,
    });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('MATCH_NOT_IN_PROGRESS');
    // Схватка ждёт подтверждения: на экране «Ковры» и в списке подтверждения.
    const queue = await w.refs.judge1.s.agent.get(`/api/v1/mats/${w.mats[0]!.id}/queue`);
    expect((queue.body.data as MatQueueDto).awaitingConfirmation.map((x) => x.matchId)).toContain(matchId);
    const pending = await w.refs.chief1.s.agent.get(
      `/api/v1/competitions/${w.competitionId}/pending-confirmations`,
    );
    const row = (pending.body.data as PendingConfirmationDto[]).find((x) => x.id === matchId);
    expect(row).toMatchObject({ canConfirm: true, result: { status: 'PROVISIONAL' } });
  });

  it('only the mat chief of this session or the chief referee confirms; the winner moves on', async () => {
    let m = await getMatch(w.refs.judge1.s, matchId);
    expect(m.allowedActions).not.toContain('result.confirm');
    const byJudge = await confirm(w.refs.judge1.s, m);
    expect(byJudge.status).toBe(403);
    const byManager = await confirm(w.staff.manager, m);
    expect(byManager.status).toBe(403);
    const byChief = await confirm(w.refs.chief1.s, m);
    expect(byChief.status, JSON.stringify(byChief.body)).toBe(200);
    m = byChief.body.data as MatchDetailDto;
    expect(m.result).toMatchObject({ status: 'CONFIRMED', confirmedBy: { id: w.refs.chief1.id } });
    const again = await confirm(w.refs.chief1.s, m);
    expect(again.status).toBe(422);
    const final = (await bracketNodes(w.staff.manager, categoryId)).find((n) => n.label === 'FINAL');
    expect([final?.red.entryId, final?.blue.entryId]).toContain(m.red.entryId);
    const semi = (await bracketNodes(w.staff.manager, categoryId)).find((n) => n.match?.id === matchId);
    expect(semi).toMatchObject({
      status: 'DECIDED',
      winnerSide: 'RED',
      match: { result: { method: 'POINTS' } },
    });
    expect(
      await t.admin.outboxEvent.count({ where: { type: 'match.result_confirmed', aggregateId: matchId } }),
    ).toBe(1);
  });

  it('keeps the event log append-only for the application role and feeds the sync log', async () => {
    const db = t.app.get(PrismaService);
    await expect(
      db.$executeRaw`UPDATE match_event SET value = 1 WHERE match_id = ${matchId}::uuid`,
    ).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM match_event WHERE match_id = ${matchId}::uuid`).rejects.toThrow();
    const tables = await t.admin.syncLog.groupBy({
      by: ['tableName'],
      where: { competitionId: w.competitionId, tableName: { in: ['match_event', 'match_result'] } },
      _count: true,
    });
    expect(tables.map((x) => x.tableName).sort()).toEqual(['match_event', 'match_result']);
  });
});

/** Две круговые категории на двоих: первый спортсмен первой категории заявлен и во вторую (entries[0] обеих). */
async function sharedAthleteWorld(): Promise<RefereeWorld> {
  return refereeWorld(t, [{ admitted: 2 }, { admitted: 2 }], async (world, cats) => {
    const [a, b] = cats as [(typeof cats)[number], (typeof cats)[number]];
    const shared = await t.admin.entry.findUniqueOrThrow({ where: { id: a.entries[0]! } });
    const replaced = b.entries[0]!;
    await t.admin.admission.deleteMany({ where: { entryId: replaced } });
    await t.admin.entry.delete({ where: { id: replaced } });
    const entryId = uuidv7();
    await t.admin.entry.create({
      data: { ...shared, id: entryId, categoryId: b.categoryId, declaredCategoryId: b.categoryId },
    });
    await t.admin.admission.create({
      data: {
        id: uuidv7(),
        competitionId: world.competitionId,
        entryId,
        status: 'ADMITTED',
        decidedAt: new Date(),
      },
    });
    b.entries[0] = entryId;
  });
}

describe('the same athlete in two matches', () => {
  it('two mats start at the same moment: one wins, the other gets ATHLETE_IN_ACTIVE_MATCH', async () => {
    // Две категории (круговая на двоих): спортсмен первой категории заявлен и во вторую.
    const w = await sharedAthleteWorld();
    // Турнир уже идёт: старты не ждут друг друга на блокировке турнира (первая схватка переводит его статус).
    await t.admin.competition.update({ where: { id: w.competitionId }, data: { status: 'IN_PROGRESS' } });
    for (let run = 0; run < 1; run++) {
      const [m1] = await scheduledMatches(t, w.categories[0]!.categoryId);
      const [m2] = await scheduledMatches(t, w.categories[1]!.categoryId);
      const chief = w.staff.chief;
      for (const m of [m1!, m2!]) {
        const r = await transition(chief, m, 'READY');
        expect(r.status, JSON.stringify(r.body)).toBe(200);
      }
      const [d1, d2] = await Promise.all([getMatch(chief, m1!.id), getMatch(chief, m2!.id)]);
      const results = await Promise.all([
        transition(chief, d1, 'IN_PROGRESS'),
        transition(chief, d2, 'IN_PROGRESS'),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([200, 422]);
      const loser = results.find((r) => r.status === 422);
      expect(loser?.body.error.code).toBe('ATHLETE_IN_ACTIVE_MATCH');
    }
  });

  it('no no-show for an athlete who is fighting on another mat right now', async () => {
    const w = await sharedAthleteWorld();
    const shared = w.categories[1]!.entries[0]!;
    const [m1] = await scheduledMatches(t, w.categories[0]!.categoryId);
    const [m2] = await scheduledMatches(t, w.categories[1]!.categoryId);
    const chief = w.staff.chief;
    let d1 = (await transition(chief, m1!, 'READY')).body.data as MatchDetailDto;
    d1 = (await transition(chief, d1, 'IN_PROGRESS')).body.data as MatchDetailDto;
    expect(d1.status).toBe('IN_PROGRESS');
    const d2 = await getMatch(chief, m2!.id);
    const absent = d2.red.entryId === shared ? 'RED' : 'BLUE';
    const r = await send(chief, 'post', `/api/v1/matches/${d2.id}/no-show`, { side: absent }, d2.version);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error.code).toBe('ATHLETE_IN_ACTIVE_MATCH');
    // Соперник, который не занят, — неявка записывается.
    const other = absent === 'RED' ? 'BLUE' : 'RED';
    const ok = await send(chief, 'post', `/api/v1/matches/${d2.id}/no-show`, { side: other }, d2.version);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('withdrawal after the draw: no-shows along the bracket', () => {
  it('loses the remaining matches by no-show as soon as the opponent is known, both withdrawn — both lose', async () => {
    const w = await refereeWorld(t, [{ admitted: 8, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    const nodes = await bracketNodes(w.staff.manager, categoryId);
    const quarter = (n: number) => nodes.find((x) => x.key === `MAIN:1:${n}`)!;
    // Участник 1-го четвертьфинала выигрывает его, потом снимается: соперник по полуфиналу ещё не известен.
    const qf1 = quarter(1);
    const chief = w.staff.chief;
    const played = await playToResult(chief, qf1.match!.id, 'RED');
    expect((await confirm(chief, played)).status).toBe(200);
    const winner = qf1.red.entryId!;
    const entry = await t.admin.entry.findUniqueOrThrow({ where: { id: winner } });
    const wd = await send(
      w.staff.manager,
      'post',
      `/api/v1/entries/${winner}/withdraw`,
      { reason: 'Травма на разминке' },
      entry.version,
    );
    expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    let semi = (await bracketNodes(chief, categoryId)).find((x) => x.key === 'MAIN:2:1')!;
    expect(semi.status).toBe('PENDING');
    // Соперник становится известен — снятый проигрывает неявкой без судьи.
    const qf2 = await playToResult(chief, quarter(2).match!.id, 'BLUE');
    expect((await confirm(chief, qf2)).status).toBe(200);
    semi = (await bracketNodes(chief, categoryId)).find((x) => x.key === 'MAIN:2:1')!;
    expect(semi).toMatchObject({
      status: 'DECIDED',
      winnerSide: 'BLUE',
      match: { status: 'FINISHED', result: { status: 'CONFIRMED', method: 'NO_SHOW' } },
    });
    const final = (await bracketNodes(chief, categoryId)).find((x) => x.label === 'FINAL')!;
    expect(final.red.entryId).toBe(quarter(2).blue.entryId);
    expect(
      await t.admin.auditLog.count({
        where: { action: 'match.no_show_auto', competitionId: w.competitionId },
      }),
    ).toBe(1);

    // Сняты оба участника четвертьфинала 3 (снятие обоих до того, как сетка дошла до их схватки): схватка не
    // проводится, оба проигравшие — срабатывает при следующем подтверждённом результате сетки.
    const qf3 = quarter(3);
    await t.admin.entry.updateMany({
      where: { id: { in: [qf3.red.entryId!, qf3.blue.entryId!] } },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawReason: 'Не прибыли на схватку' },
    });
    const qf4 = await playToResult(chief, quarter(4).match!.id, 'RED');
    expect((await confirm(chief, qf4)).status).toBe(200);
    const after = await bracketNodes(chief, categoryId);
    expect(after.find((x) => x.key === 'MAIN:1:3')).toMatchObject({
      status: 'DECIDED',
      winnerSide: null,
      match: { result: { method: 'NO_SHOW', winnerSide: null } },
    });
    // В полуфинале у победителя четвертьфинала 4 соперника нет — проходит без схватки.
    const semi2 = after.find((x) => x.key === 'MAIN:2:2')!;
    expect(semi2).toMatchObject({
      status: 'WALKOVER',
      winnerSide: 'BLUE',
      match: { result: { method: 'BYE' } },
    });
  });

  it('an athlete on the mat cannot be withdrawn — the crew records the outcome of the bout', async () => {
    const w = await refereeWorld(t, [{ admitted: 2 }]);
    const [m] = await scheduledMatches(t, w.categories[0]!.categoryId);
    const chief = w.staff.chief;
    let d = (await transition(chief, m!, 'READY')).body.data as MatchDetailDto;
    d = (await transition(chief, d, 'IN_PROGRESS')).body.data as MatchDetailDto;
    const entry = await t.admin.entry.findUniqueOrThrow({ where: { id: d.red.entryId! } });
    const wd = await send(
      w.staff.manager,
      'post',
      `/api/v1/entries/${entry.id}/withdraw`,
      { reason: 'Отказ от схватки' },
      entry.version,
    );
    expect(wd.status).toBe(422);
    expect(wd.body.error.details.failed).toEqual(['athlete_in_active_match']);
    // Снятие во время схватки — исход WITHDRAWAL с причиной (отличается от предложенного: исхода ещё нет).
    const res = await send(
      chief,
      'post',
      `/api/v1/matches/${d.id}/result`,
      { expectedSeq: d.seq, winnerSide: 'BLUE', method: 'WITHDRAWAL', reason: 'Отказ красного продолжать' },
      d.version,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as MatchDetailDto).result).toMatchObject({
      method: 'WITHDRAWAL',
      winnerSide: 'BLUE',
    });
  });
});

describe('results on two mats of one bracket', () => {
  it('confirming both semifinals at the same moment puts both winners into the final', async () => {
    const w = await refereeWorld(t, [{ admitted: 4, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    const semis = (await bracketNodes(w.staff.manager, categoryId)).filter((n) => n.label === 'SEMIFINAL');
    const chief = w.staff.chief;
    const done = [];
    for (const n of semis) done.push(await playToResult(chief, n.match!.id, 'BLUE'));
    const results = await Promise.all(done.map((m) => confirm(chief, m)));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const final = (await bracketNodes(chief, categoryId)).find((n) => n.label === 'FINAL')!;
    expect(final.status).toBe('READY');
    expect([final.red.entryId, final.blue.entryId].sort()).toEqual(semis.map((n) => n.blue.entryId).sort());
  });
});

describe('no-show on call, pause and BYE results', () => {
  it('records a no-show as a provisional result that the chief confirms', async () => {
    const w = await refereeWorld(t, [{ admitted: 2 }]);
    const categoryId = w.categories[0]!.categoryId;
    const [m] = await scheduledMatches(t, categoryId);
    const chief = w.staff.chief;
    const status = async () => ({
      competition: (await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } })).status,
      category: (await t.admin.competitionCategory.findUniqueOrThrow({ where: { id: categoryId } })).status,
    });
    expect(await status()).toEqual({ competition: 'SCHEDULED', category: 'DRAWN' });
    const d = await getMatch(chief, m!.id);
    const r = await send(chief, 'post', `/api/v1/matches/${d.id}/no-show`, { side: 'BLUE' }, d.version);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = r.body.data as MatchDetailDto;
    expect(after).toMatchObject({
      status: 'FINISHED',
      result: { status: 'PROVISIONAL', method: 'NO_SHOW', winnerSide: 'RED' },
    });
    expect((await confirm(chief, after)).status).toBe(200);
    // Первый подтверждённый результат без старта схватки тоже открывает соревнования и категорию.
    expect(await status()).toEqual({ competition: 'IN_PROGRESS', category: 'IN_PROGRESS' });
  });

  it('an automatic no-show of a withdrawn athlete does not block a new draw version', async () => {
    const w = await refereeWorld(t, [{ admitted: 4, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    const semi = (await bracketNodes(w.staff.manager, categoryId)).find((x) => x.key === 'MAIN:1:1')!;
    const entry = await t.admin.entry.findUniqueOrThrow({ where: { id: semi.red.entryId! } });
    const wd = await send(
      w.staff.manager,
      'post',
      `/api/v1/entries/${entry.id}/withdraw`,
      { reason: 'Не прошёл взвешивание' },
      entry.version,
    );
    expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    const decided = (await bracketNodes(w.staff.manager, categoryId)).find((x) => x.key === 'MAIN:1:1')!;
    expect(decided.match?.result).toMatchObject({ status: 'CONFIRMED', method: 'NO_SHOW' });
    const draw = await t.admin.draw.findFirstOrThrow({ where: { categoryId, status: 'PUBLISHED' } });
    const r = await send(
      w.staff.chief,
      'post',
      `/api/v1/draws/${draw.id}/supersede`,
      { reason: 'Снят участник до начала схваток' },
      draw.version,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await t.admin.match.count({ where: { categoryId } })).toBe(0);
  });

  it('pauses only with the clock stopped and resumes', async () => {
    const w = await refereeWorld(t, [{ admitted: 2 }]);
    const [m] = await scheduledMatches(t, w.categories[0]!.categoryId);
    const chief = w.staff.chief;
    let d = (await transition(chief, m!, 'READY')).body.data as MatchDetailDto;
    d = (await transition(chief, d, 'IN_PROGRESS')).body.data as MatchDetailDto;
    await event(chief, d.id, { type: 'CLOCK_STARTED', expectedSeq: 0 });
    d = await getMatch(chief, d.id);
    const busy = await transition(chief, d, 'PAUSED');
    expect(busy.status).toBe(422);
    expect(busy.body.error.details.failed).toEqual(['clock_running']);
    await event(chief, d.id, { type: 'CLOCK_STOPPED', expectedSeq: 1, matchClockMs: 45_000 });
    d = await getMatch(chief, d.id);
    const paused = await transition(chief, d, 'PAUSED', 'Врач на ковре');
    expect(paused.status).toBe(200);
    d = paused.body.data as MatchDetailDto;
    const blocked = await event(chief, d.id, { type: 'CLOCK_STARTED', expectedSeq: 2, matchClockMs: 45_000 });
    expect(blocked.body.error.code).toBe('MATCH_NOT_IN_PROGRESS');
    const resumed = await transition(chief, d, 'IN_PROGRESS');
    expect(resumed.status).toBe(200);
    expect((resumed.body.data as MatchDetailDto).status).toBe('IN_PROGRESS');
  });

  it('gives matches decided without an opponent at the draw a BYE result confirmed by the system', async () => {
    const w = await refereeWorld(t, [{ admitted: 3, format: 'SINGLE_ELIMINATION' }]);
    const results = await t.admin.matchResult.findMany({
      where: { match: { categoryId: w.categories[0]!.categoryId } },
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'CONFIRMED', method: 'BYE', confirmedById: null });
  });
});

describe('screens: mat console, officiating section, mats screen', () => {
  it('a match waiting for a winner from another mat does not hold the tablet: the next callable one is current', async () => {
    const w = await refereeWorld(t, [{ admitted: 3, format: 'SINGLE_ELIMINATION' }]);
    const categoryId = w.categories[0]!.categoryId;
    const all = await scheduledMatches(t, categoryId);
    const known = all.find(
      (m) => m.status === 'SCHEDULED' && m.participants.every((p) => p.entryId !== null),
    )!;
    const waiting = all.find(
      (m) => m.status === 'SCHEDULED' && m.participants.some((p) => p.entryId === null),
    )!;
    // Финал (ждёт победителя полуфинала) по плану раньше полуфинала, оба на одном ковре.
    await t.admin.matchSchedule.update({
      where: { matchId: waiting.id },
      data: {
        plannedAt: new Date(known.schedule!.plannedAt.getTime() - 60_000),
        matId: known.schedule!.matId,
      },
    });
    const con = await w.staff.chief.agent.get(`/api/v1/mats/${known.schedule!.matId}/console`);
    expect(con.status, JSON.stringify(con.body)).toBe(200);
    const c = con.body.data as MatConsoleDto;
    expect(c.current?.id).toBe(known.id);
    expect(c.current?.allowedActions).toContain('transition:READY');
    const q = await w.staff.chief.agent.get(`/api/v1/mats/${known.schedule!.matId}/queue`);
    expect((q.body.data as MatQueueDto).current?.matchId).toBe(known.id);
  });

  it('shows my mats first, the current match with its actions and the expected time of the next ones', async () => {
    const w = await refereeWorld(t, [{ admitted: 4 }]);
    const categoryId = w.categories[0]!.categoryId;
    await t.admin.matchSchedule.updateMany({
      where: { match: { categoryId } },
      data: { matId: w.mats[1]!.id },
    });
    const off = await w.refs.judge2.s.agent.get(`/api/v1/competitions/${w.competitionId}/officiating`);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const o = off.body.data as OfficiatingDto;
    expect(o.mats[0]).toMatchObject({ id: w.mats[1]!.id, myRoles: ['REFEREE'] });
    expect(o.currentSessionId).toBe(w.session.id);

    const con = await w.refs.judge2.s.agent.get(`/api/v1/mats/${w.mats[1]!.id}/console`);
    expect(con.status, JSON.stringify(con.body)).toBe(200);
    const c = con.body.data as MatConsoleDto;
    expect(c.myRoles).toEqual(['REFEREE']);
    expect(c.current?.allowedActions).toEqual(expect.arrayContaining(['transition:READY', 'no_show']));
    expect(c.current?.rules.actions.map((a) => a.code)).toContain('THROW_4');
    expect(c.next).not.toBeNull();

    // Ковёр стартовал на час позже плана: следующие схватки ожидаются позже планового времени.
    const first = c.current!;
    await t.admin.matchSchedule.updateMany({
      where: { match: { categoryId } },
      data: { plannedAt: { set: new Date(Date.now() - 60 * 60_000) } },
    });
    let d = (await transition(w.refs.judge2.s, first, 'READY')).body.data as MatchDetailDto;
    d = (await transition(w.refs.judge2.s, d, 'IN_PROGRESS')).body.data as MatchDetailDto;
    const q = await w.refs.judge2.s.agent.get(`/api/v1/mats/${w.mats[1]!.id}/queue`);
    const queue = q.body.data as MatQueueDto;
    expect(queue.current).toMatchObject({ matchId: d.id, status: 'IN_PROGRESS', score: { red: 0, blue: 0 } });
    expect(queue.delaySeconds).toBeGreaterThan(55 * 60);
    expect(Date.parse(queue.next[0]!.expectedAt)).toBeGreaterThan(Date.parse(queue.next[0]!.plannedAt));
  });
});
