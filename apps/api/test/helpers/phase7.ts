// Фикстуры Phase 7a: турнир с опубликованными сетками, расписанием и бригадами на коврах — после фикстуры можно
// судить схватки. Правила — пример спортивного самбо из packages/contracts (4/2/1, удержание 10 с/20 с, наказания
// по порядку, преимущество 8). Путь до расписания проходит через API, как на демонстрации.
import { randomUUID } from 'node:crypto';
import {
  type DrawDto,
  type MatchDetailDto,
  type MatchEventResultDto,
  type MatDto,
  type RoleCode,
  SAMPLE_RULESET_PARAMETERS,
  type ScheduleDto,
  type ScheduleSessionDto,
} from '@sde/contracts';
import { type Prisma, uuidv7 } from '@sde/db';
import { expect } from 'vitest';
import { createUser, login, type Session, type TestApp } from './app';
import { send } from './phase3';
import { isoDate } from './phase4';
import { type CategoryFixture, drawCategory, drawWorld, type DrawWorld, SEED_A } from './phase5';

export interface Official {
  id: string;
  s: Session;
}

export interface RefereeWorld extends DrawWorld {
  mats: MatDto[];
  session: ScheduleSessionDto;
  categories: CategoryFixture[];
  /** Бригады: ковёр 1 — руководитель (MAT_CHIEF) и судья; ковёр 2 — судья; ещё один судья без назначения. */
  refs: { chief1: Official; judge1: Official; judge2: Official; idle: Official };
}

export async function official(
  t: TestApp,
  competitionId: string,
  role: RoleCode = 'REFEREE',
): Promise<Official> {
  const user = await createUser(t);
  const r = await t.admin.role.findUniqueOrThrow({ where: { code: role } });
  await t.admin.competitionMembership.create({
    data: { id: uuidv7(), competitionId, userId: user.id, roleId: r.id, status: 'ACTIVE' },
  });
  return { id: user.id, s: await login(t, user.email) };
}

async function sampleRuleSet(t: TestApp): Promise<string> {
  const ruleSetId = uuidv7();
  await t.admin.ruleSet.create({
    data: {
      id: ruleSetId,
      code: `RS_${ruleSetId.slice(-8).toUpperCase()}`,
      disciplineCode: 'SPORT_SAMBO',
      name: 'Правила самбо',
    },
  });
  const id = uuidv7();
  await t.admin.ruleSetVersion.create({
    data: {
      id,
      ruleSetId,
      version: 1,
      schemaVersion: 1,
      parameters: {
        ...SAMPLE_RULESET_PARAMETERS,
        matchDuration: [{ ageFrom: 10, ageTo: 17, seconds: 180 }],
        repechageMatchSeconds: 150,
      },
      checksum: 'c'.repeat(64),
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  return id;
}

export interface CategorySpec {
  admitted: number;
  format?: 'ROUND_ROBIN' | 'SINGLE_ELIMINATION' | 'ELIMINATION_WITH_REPECHAGE';
}

/**
 * Турнир «Расписание готово»: категории с опубликованными сетками, 2 ковра, сессия дня турнира, построенное и
 * опубликованное расписание, бригады ковров. Категории — до публикации расписания (`extra` — дополнительная
 * подготовка участий, например общий спортсмен в двух категориях).
 */
export async function refereeWorld(
  t: TestApp,
  specs: CategorySpec[],
  extra?: (w: DrawWorld, cats: CategoryFixture[]) => Promise<void>,
): Promise<RefereeWorld> {
  const w = await drawWorld(t, { clubs: 4 });
  await t.admin.competition.update({
    where: { id: w.competitionId },
    data: { ruleSetVersionId: await sampleRuleSet(t) },
  });
  const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
  const day = isoDate(competition.startDate);
  const mats: MatDto[] = [];
  for (const number of [1, 2]) {
    const r = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/mats`, { number });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    mats.push(r.body.data as MatDto);
  }
  const sr = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/sessions`, {
    name: 'День',
    startsAt: `${day}T06:00:00.000Z`,
    endsAt: `${day}T18:00:00.000Z`,
  });
  expect(sr.status, JSON.stringify(sr.body)).toBe(201);
  const session = sr.body.data as ScheduleSessionDto;

  const categories: CategoryFixture[] = [];
  for (const spec of specs) categories.push(await drawCategory(t, w, spec.admitted));
  if (extra) await extra(w, categories);
  for (const [i, spec] of specs.entries()) {
    const cat = categories[i] as CategoryFixture;
    const draft = await send(w.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {
      randomSeed: SEED_A,
      ...(spec.format ? { format: spec.format } : {}),
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const d = draft.body.data as DrawDto;
    const pub = await send(w.staff.manager, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  }

  const gen = await send(
    w.staff.manager,
    'post',
    `/api/v1/competitions/${w.competitionId}/schedule/generate`,
    {
      finalsBlock: false,
    },
  );
  expect(gen.status, JSON.stringify(gen.body)).toBe(201);
  const schedule = gen.body.data as ScheduleDto;
  expect(schedule.unassigned).toEqual([]);
  const pub = await send(
    w.staff.manager,
    'post',
    `/api/v1/competitions/${w.competitionId}/schedule/publish`,
    {},
    schedule.version,
  );
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  const current = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
  const tr = await send(
    w.staff.manager,
    'post',
    `/api/v1/competitions/${w.competitionId}/transitions`,
    { to: 'SCHEDULED' },
    current.version,
  );
  expect(tr.status, JSON.stringify(tr.body)).toBe(200);

  const refs = {
    chief1: await official(t, w.competitionId),
    judge1: await official(t, w.competitionId),
    judge2: await official(t, w.competitionId),
    idle: await official(t, w.competitionId),
  };
  const crew = async (matId: string, assignments: { role: string; userId: string }[]): Promise<void> => {
    const r = await send(w.staff.chief, 'put', `/api/v1/competitions/${w.competitionId}/mat-assignments`, {
      sessionId: session.id,
      matId,
      assignments,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  await crew(mats[0]!.id, [
    { role: 'MAT_CHIEF', userId: refs.chief1.id },
    { role: 'REFEREE', userId: refs.judge1.id },
  ]);
  await crew(mats[1]!.id, [{ role: 'REFEREE', userId: refs.judge2.id }]);
  return { ...w, mats, session, categories, refs };
}

export type ScheduledMatch = Prisma.MatchGetPayload<{
  include: { participants: true; schedule: true; result: true };
}>;

/** Схватки категории с местом в расписании, в порядке расписания. */
export async function scheduledMatches(t: TestApp, categoryId: string): Promise<ScheduledMatch[]> {
  return t.admin.match.findMany({
    where: { categoryId, schedule: { isNot: null } },
    include: { participants: true, schedule: true, result: true },
    orderBy: { schedule: { plannedAt: 'asc' } },
  });
}

export async function getMatch(s: Session, matchId: string): Promise<MatchDetailDto> {
  const r = await s.agent.get(`/api/v1/matches/${matchId}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as MatchDetailDto;
}

export function transition(
  s: Session,
  m: { id: string; version: number },
  to: string,
  reason?: string,
): Promise<ApiResponse> {
  return send(
    s,
    'post',
    `/api/v1/matches/${m.id}/transitions`,
    { to, ...(reason ? { reason } : {}) },
    m.version,
  );
}

const T0 = Date.parse('2030-01-01T10:00:00.000Z');

/** Событие схватки: ключ идемпотентности — новый, если не передан. */
export function event(
  s: Session,
  matchId: string,
  body: Record<string, unknown>,
  key: string = randomUUID(),
): Promise<ApiResponse> {
  const clock = typeof body.matchClockMs === 'number' ? body.matchClockMs : 0;
  return s.agent
    .post(`/api/v1/matches/${matchId}/events`)
    .set('x-csrf-token', s.csrf)
    .set('idempotency-key', key)
    .send({ matchClockMs: clock, deviceTime: new Date(T0 + clock).toISOString(), ...body });
}

export function voidEvent(
  s: Session,
  matchId: string,
  eventId: string,
  expectedSeq: number,
): Promise<ApiResponse> {
  return s.agent
    .post(`/api/v1/matches/${matchId}/events/${eventId}/void`)
    .set('x-csrf-token', s.csrf)
    .set('idempotency-key', randomUUID())
    .send({ expectedSeq, reason: 'Ошибка ввода' });
}

/**
 * Схватка от вызова до предварительного результата: вызов, старт, секундомер, бросок на 4 победителю, время
 * вышло, результат по баллам. Возвращает схватку после результата (ждёт подтверждения).
 */
export async function playToResult(
  s: Session,
  matchId: string,
  winner: 'RED' | 'BLUE',
): Promise<MatchDetailDto> {
  let m = await getMatch(s, matchId);
  if (m.status === 'SCHEDULED') {
    const r = await transition(s, m, 'READY');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    m = r.body.data as MatchDetailDto;
  }
  const started = await transition(s, m, 'IN_PROGRESS');
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  m = started.body.data as MatchDetailDto;
  const duration = (m.durationSeconds ?? 180) * 1000;
  const steps: Record<string, unknown>[] = [
    { type: 'CLOCK_STARTED', matchClockMs: 0 },
    { type: 'SCORE', side: winner, actionCode: 'THROW_4', matchClockMs: 30_000 },
    { type: 'CLOCK_STOPPED', matchClockMs: duration },
  ];
  let seq = m.seq;
  for (const step of steps) {
    const r = await event(s, matchId, { ...step, expectedSeq: seq });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    seq = (r.body.data as MatchEventResultDto).seq;
  }
  m = await getMatch(s, matchId);
  const res = await send(
    s,
    'post',
    `/api/v1/matches/${matchId}/result`,
    { expectedSeq: seq, winnerSide: winner, method: 'POINTS' },
    m.version,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as MatchDetailDto;
}

export async function confirm(s: Session, m: { id: string; version: number }): Promise<ApiResponse> {
  return send(s, 'post', `/api/v1/matches/${m.id}/result/confirm`, {}, m.version);
}

/** Ответ API в тестах: статус и тело (тип supertest не переносим между пакетами). */
export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- тело ответа проверяется в тестах по месту
  body: any;
}
