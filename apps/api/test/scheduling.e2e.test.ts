// Расписание (Phase 6, §2–§6; план §11): ковры и сессии, автопланировщик (зависимости, закрепление за ковром,
// блок финалов), ручная правка пакетом (If-Match, перестановка, запреты, предупреждения → confirm), публикация и
// переход DRAWING → SCHEDULED, изменение после публикации → событие клубам, новая версия жеребьёвки убирает
// схватки из расписания, бригады ковра (кандидаты, конфликт, копирование), экран «Ковры», журнал синхронизации.
// Права на все маршруты и отказ при чужом праве записи — route-security.e2e.test.ts (автотест по всей API:
// маршруты модуля обнаруживаются через ModulesContainer, без отдельного списка).
import type {
  CrewCandidateDto,
  DrawDto,
  MatAssignmentDto,
  MatDto,
  MatQueueDto,
  ScheduleDto,
  ScheduleSessionDto,
} from '@sde/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BracketsService } from '../src/modules/brackets';
import { createTestApp, createUser, login, resetData, type Session, type TestApp } from './helpers/app';
import { isoDate } from './helpers/phase4';
import { send } from './helpers/phase3';
import { type CategoryFixture, drawCategory, drawWorld, type DrawWorld, SEED_A, SEED_B } from './helpers/phase5';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

async function draft(s: Session, categoryId: string, body: Record<string, unknown> = {}): Promise<DrawDto> {
  const r = await send(s, 'post', `/api/v1/categories/${categoryId}/draws`, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as DrawDto;
}

async function publish(s: Session, d: DrawDto): Promise<DrawDto> {
  const r = await send(s, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as DrawDto;
}

async function publishedDrawId(categoryId: string): Promise<string> {
  return (await t.admin.draw.findFirstOrThrow({ where: { categoryId, status: 'PUBLISHED' } })).id;
}

/**
 * Схватка категории с настоящей зависимостью (не круговая система) и то, от чего она зависит — обе уже стоят в
 * сгенерированном расписании (годны к расписанию, см. schedule-assembly.eligibleForScheduling) на одном ковре
 * (категория целиком стоит на одном ковре — раздел 2). Используется только для проверки запрета на тупик:
 * меняем местами их позиции (orderInMat) напрямую, остальные схватки не трогаем. У зависимости (earlier) в
 * бракете может быть и другой потомок (например, по ветке утешительных встреч) — если он тоже окажется в
 * очереди раньше earlier после перестановки, тупик всё равно будет обнаружен именно на earlier, просто первой
 * в списке нарушений может оказаться не later, а этот другой потомок; проверка ниже поэтому не требует, чтобы
 * именно later была заблокированной стороной — только что earlier назван причиной тупика.
 */
async function dependencyPair(
  categoryId: string,
  schedule: ScheduleDto,
): Promise<{ matId: string; later: { matchId: string; orderInMat: number }; earlier: { matchId: string; orderInMat: number } }> {
  const scheduledIds = new Set(schedule.items.filter((i) => i.categoryId === categoryId).map((i) => i.matchId));
  const itemById = new Map(schedule.items.map((i) => [i.matchId, i]));
  const drawId = await publishedDrawId(categoryId);
  const deps = await t.app.get(BracketsService).matchDependencies(null, drawId);
  for (const d of deps.values()) {
    if (!scheduledIds.has(d.matchId)) continue;
    const earlierId = d.dependsOn.find((id) => scheduledIds.has(id));
    if (!earlierId) continue;
    const laterItem = itemById.get(d.matchId)!;
    const earlierItem = itemById.get(earlierId)!;
    if (laterItem.matId !== earlierItem.matId) continue; // перестановка мест только в пределах одного ковра
    return {
      matId: laterItem.matId,
      later: { matchId: laterItem.matchId, orderInMat: laterItem.orderInMat },
      earlier: { matchId: earlierItem.matchId, orderInMat: earlierItem.orderInMat },
    };
  }
  throw new Error('fixture: category has no same-mat match with a schedulable dependency');
}

async function createMat(s: Session, competitionId: string, number: number): Promise<MatDto> {
  const r = await send(s, 'post', `/api/v1/competitions/${competitionId}/mats`, { number });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as MatDto;
}

async function createSession(
  s: Session,
  competitionId: string,
  name: string,
  startsAt: string,
  endsAt: string,
): Promise<ScheduleSessionDto> {
  const r = await send(s, 'post', `/api/v1/competitions/${competitionId}/sessions`, { name, startsAt, endsAt });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as ScheduleSessionDto;
}

async function getSchedule(s: Session, competitionId: string): Promise<ScheduleDto> {
  const r = await s.agent.get(`/api/v1/competitions/${competitionId}/schedule`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as ScheduleDto;
}

async function generate(
  s: Session,
  competitionId: string,
  body: Record<string, unknown> = {},
): Promise<ScheduleDto> {
  const r = await send(s, 'post', `/api/v1/competitions/${competitionId}/schedule/generate`, body);
  // POST без @HttpCode — стандартный Nest-код создания (201), хотя тело — пересчитанное расписание, не новый ресурс.
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as ScheduleDto;
}

interface ReadyWorld {
  w: DrawWorld;
  mats: MatDto[];
  session: ScheduleSessionDto;
  /** ELIMINATION_WITH_REPECHAGE (7 участников) — у схваток есть зависимости. */
  cat1: CategoryFixture;
  /** ROUND_ROBIN (4 участника) — схватки друг от друга не зависят. */
  cat2: CategoryFixture;
}

/** Турнир готов к построению расписания вручную: 2 ковра, одна сессия турнирного дня, две опубликованные сетки. */
async function readyWorld(): Promise<ReadyWorld> {
  const w = await drawWorld(t);
  const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
  const day = isoDate(competition.startDate);
  const mats = [
    await createMat(w.staff.manager, w.competitionId, 1),
    await createMat(w.staff.manager, w.competitionId, 2),
  ];
  const session = await createSession(
    w.staff.manager,
    w.competitionId,
    'Утро',
    `${day}T06:00:00.000Z`,
    `${day}T16:00:00.000Z`,
  );
  const cat1 = await drawCategory(t, w, 7);
  const cat2 = await drawCategory(t, w, 4);
  await publish(w.staff.manager, await draft(w.staff.manager, cat1.categoryId, { randomSeed: SEED_A }));
  await publish(w.staff.manager, await draft(w.staff.manager, cat2.categoryId, { randomSeed: SEED_B }));
  return { w, mats, session, cat1, cat2 };
}

describe('mats', () => {
  it('creates, lists and updates mats; blocks duplicate numbers, stale versions and staff without mat.manage', async () => {
    const w = await drawWorld(t);
    const created = await createMat(w.staff.manager, w.competitionId, 1);
    expect(created).toMatchObject({ number: 1, name: null, isActive: true, version: 1, allowedActions: ['mat.manage'] });

    const dup = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/mats`, { number: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('MAT_NUMBER_TAKEN');

    // schedule.manage (секретарь) не включает mat.manage.
    const bySecretary = await send(w.staff.secretary, 'post', `/api/v1/competitions/${w.competitionId}/mats`, { number: 2 });
    expect(bySecretary.status).toBe(403);

    const list = await w.staff.secretary.agent.get(`/api/v1/competitions/${w.competitionId}/mats`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const patched = await send(
      w.staff.manager,
      'patch',
      `/api/v1/competitions/${w.competitionId}/mats/${created.id}`,
      { name: 'Ковёр А', isActive: false },
      created.version,
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data).toMatchObject({ name: 'Ковёр А', isActive: false, version: 2 });

    const stale = await send(
      w.staff.manager,
      'patch',
      `/api/v1/competitions/${w.competitionId}/mats/${created.id}`,
      { name: 'ещё раз' },
      created.version,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('sessions', () => {
  it('creates sessions inside competition dates, blocks overlap and dates outside the tournament, allows schedule.manage staff only', async () => {
    const w = await drawWorld(t);
    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const day = isoDate(competition.startDate);

    const morning = await createSession(w.staff.secretary, w.competitionId, 'Утро', `${day}T06:00:00.000Z`, `${day}T10:00:00.000Z`);
    expect(morning).toMatchObject({ name: 'Утро', version: 1, allowedActions: ['schedule.manage'] });

    // главный судья не входит в schedule.manage.
    const byChief = await send(w.staff.chief, 'post', `/api/v1/competitions/${w.competitionId}/sessions`, {
      name: 'День',
      startsAt: `${day}T11:00:00.000Z`,
      endsAt: `${day}T12:00:00.000Z`,
    });
    expect(byChief.status).toBe(403);

    const overlap = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/sessions`, {
      name: 'Пересечение',
      startsAt: `${day}T09:00:00.000Z`,
      endsAt: `${day}T12:00:00.000Z`,
    });
    expect(overlap.status).toBe(422);
    expect(overlap.body.error.code).toBe('SESSION_OVERLAP');

    // 22:00Z в Europe/Moscow (+3) — уже следующие местные сутки, за пределами однодневного турнира.
    const outside = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/sessions`, {
      name: 'Не в датах турнира',
      startsAt: `${day}T22:00:00.000Z`,
      endsAt: `${day}T23:00:00.000Z`,
    });
    expect(outside.status).toBe(400);
    expect(outside.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ path: 'startsAt', code: 'outside_competition_dates' }] },
    });

    const patched = await send(
      w.staff.secretary,
      'patch',
      `/api/v1/competitions/${w.competitionId}/sessions/${morning.id}`,
      { name: 'Утренняя' },
      morning.version,
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data).toMatchObject({ name: 'Утренняя', version: 2 });

    const stale = await send(
      w.staff.manager,
      'patch',
      `/api/v1/competitions/${w.competitionId}/sessions/${morning.id}`,
      { name: 'ещё раз' },
      morning.version,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('generation', () => {
  it('fills the session from published draws, uses both mats, and puts the finals block after everything else', async () => {
    const { w, mats, session, cat1 } = await readyWorld();
    const schedule = await generate(w.staff.secretary, w.competitionId, {});
    expect(schedule.status).toBe('DRAFT');
    expect(schedule.unassigned).toEqual([]);

    const eligible = await t.admin.match.findMany({
      where: { competitionId: w.competitionId, matchNumber: { not: null } },
      select: { id: true },
    });
    expect(new Set(schedule.items.map((i) => i.matchId))).toEqual(new Set(eligible.map((m) => m.id)));
    expect(schedule.items.every((i) => i.sessionId === session.id)).toBe(true);
    expect(new Set(schedule.items.map((i) => i.matId))).toEqual(new Set(mats.map((m) => m.id)));

    // Блок финалов (план §6): финал и схватка за 3-е место — не раньше конца обычной части на любом ковре.
    const finalRows = schedule.items.filter((i) => i.roundLabel === 'FINAL' || i.roundLabel === 'BRONZE');
    const otherRows = schedule.items.filter((i) => i.roundLabel !== 'FINAL' && i.roundLabel !== 'BRONZE');
    expect(finalRows.filter((i) => i.categoryId === cat1.categoryId).length).toBeGreaterThan(0);
    const maxOtherEnd = Math.max(...otherRows.map((i) => new Date(i.endsAt).getTime()));
    const minFinalStart = Math.min(...finalRows.map((i) => new Date(i.plannedAt).getTime()));
    expect(minFinalStart).toBeGreaterThanOrEqual(maxOtherEnd);
  });

  it('respects a category pin to a mat and reports unassigned matches when there is no capacity', async () => {
    const w = await drawWorld(t, { clubs: 2 });
    const mats = [
      await createMat(w.staff.manager, w.competitionId, 1),
      await createMat(w.staff.manager, w.competitionId, 2),
    ];
    const cat = await drawCategory(t, w, 4);
    await publish(w.staff.manager, await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A }));

    const noCapacity = await generate(w.staff.manager, w.competitionId, {});
    expect(noCapacity.unassigned.length).toBeGreaterThan(0);
    expect(noCapacity.unassigned[0]).toMatchObject({ categoryId: cat.categoryId, reason: 'no_session_capacity' });

    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const day = isoDate(competition.startDate);
    await createSession(w.staff.manager, w.competitionId, 'Утро', `${day}T06:00:00.000Z`, `${day}T16:00:00.000Z`);
    // Без закрепления единственная категория встала бы на ковёр №1 (меньший номер при равной загрузке).
    const pinned = await generate(w.staff.manager, w.competitionId, {
      categoryPins: [{ categoryId: cat.categoryId, matId: mats[1]!.id }],
    });
    expect(pinned.unassigned).toEqual([]);
    expect(pinned.items.every((i) => i.matId === mats[1]!.id)).toBe(true);
  });

  it('reports no_active_mats when the competition has no active mat', async () => {
    const w = await drawWorld(t, { clubs: 2 });
    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const day = isoDate(competition.startDate);
    await createSession(w.staff.manager, w.competitionId, 'Утро', `${day}T06:00:00.000Z`, `${day}T16:00:00.000Z`);
    const cat = await drawCategory(t, w, 4);
    await publish(w.staff.manager, await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A }));
    const noMats = await generate(w.staff.manager, w.competitionId, {});
    expect(noMats.unassigned[0]).toMatchObject({ reason: 'no_active_mats' });
  });
});

describe('manual editing — moving matches', () => {
  it('moves matches with If-Match, rejects a stale version and duplicate matches, and records audit + sync log', async () => {
    const { w, session, cat2 } = await readyWorld();
    await generate(w.staff.manager, w.competitionId, {});
    const schedule = await getSchedule(w.staff.manager, w.competitionId);
    const cat2Items = schedule.items.filter((i) => i.categoryId === cat2.categoryId).sort((a, b) => a.orderInMat - b.orderInMat);
    const [a, b] = cat2Items;

    const duplicate = await send(
      w.staff.secretary,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      {
        moves: [
          { matchId: a!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: b!.orderInMat },
          { matchId: a!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: a!.orderInMat },
        ],
      },
      schedule.version,
    );
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.details.fields).toEqual([{ path: 'moves', code: 'duplicate_match' }]);

    // главный судья (mat_assignment.manage) не входит в schedule.manage.
    const byChief = await send(
      w.staff.chief,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      { moves: [{ matchId: a!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: b!.orderInMat }] },
      schedule.version,
    );
    expect(byChief.status).toBe(403);

    const stale = await send(
      w.staff.secretary,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      { moves: [{ matchId: a!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: b!.orderInMat }] },
      schedule.version + 1,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    // confirm: true — пересчёт времени задевает весь турнир (и категорию cat1 с её собственными, не
    // затронутыми этим пакетом зависимостями), а не только переставленные схватки.
    const moved = await send(
      w.staff.secretary,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      {
        moves: [
          { matchId: a!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: b!.orderInMat, locked: true },
          { matchId: b!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: a!.orderInMat },
        ],
        confirm: true,
      },
      schedule.version,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const data = moved.body.data as ScheduleDto;
    expect(data.version).toBe(schedule.version + 1);
    const byId = new Map(data.items.map((i) => [i.matchId, i]));
    expect(byId.get(a!.matchId)).toMatchObject({ orderInMat: b!.orderInMat, locked: true });
    expect(byId.get(b!.matchId)).toMatchObject({ orderInMat: a!.orderInMat, locked: false });

    const audit = await t.admin.auditLog.findFirst({
      where: { action: 'schedule.items_moved', competitionId: w.competitionId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.after).toMatchObject({
      [a!.matchId]: { orderInMat: b!.orderInMat, locked: true },
      [b!.matchId]: { orderInMat: a!.orderInMat, locked: false },
    });

    const sync = await t.admin.syncLog.findFirst({
      where: { competitionId: w.competitionId, tableName: 'match_schedule' },
    });
    expect(sync).not.toBeNull();
  });
});

describe('manual editing — forbidden and warned moves', () => {
  it('refuses a batch that would deadlock a dependency (SCHEDULE_ORDER_VIOLATION)', async () => {
    const { w, session, cat1 } = await readyWorld();
    await generate(w.staff.manager, w.competitionId, {});
    const schedule = await getSchedule(w.staff.manager, w.competitionId);
    const { matId, later, earlier } = await dependencyPair(cat1.categoryId, schedule);

    // Меняем местами два места на ковре: схватка-потомок встаёт раньше той, от которой зависит, — тупик (ни
    // одна из двух не сможет освободить очередь первой), а третьи схватки не трогаем вовсе.
    const r = await send(
      w.staff.manager,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      {
        moves: [
          { matchId: later.matchId, sessionId: session.id, matId, orderInMat: earlier.orderInMat },
          { matchId: earlier.matchId, sessionId: session.id, matId, orderInMat: later.orderInMat },
        ],
      },
      schedule.version,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error.code).toBe('SCHEDULE_ORDER_VIOLATION');
    // Заблокированной стороной тупика сервер может назвать either later, либо другого потомка той же earlier
    // (например, по ветке утешительных встреч), если тот тоже оказался в очереди раньше earlier; важно только,
    // что причина тупика названа верно.
    const violations = r.body.error.details.violations as { matchId: string; blockedOn: string }[];
    expect(violations.some((v) => v.blockedOn === earlier.matchId)).toBe(true);
  });

  it('forbids moving a match that has already started or been played', async () => {
    const { w, session, cat2 } = await readyWorld();
    await generate(w.staff.manager, w.competitionId, {});
    const schedule = await getSchedule(w.staff.manager, w.competitionId);
    const cat2Items = schedule.items.filter((i) => i.categoryId === cat2.categoryId).sort((a, b) => a.orderInMat - b.orderInMat);
    const [started, other] = cat2Items;
    await t.admin.match.update({ where: { id: started!.matchId }, data: { status: 'IN_PROGRESS' } });

    const r = await send(
      w.staff.manager,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      { moves: [{ matchId: started!.matchId, sessionId: session.id, matId: other!.matId, orderInMat: 999 }] },
      schedule.version,
    );
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'MATCH_ALREADY_STARTED', details: { matchId: started!.matchId } });
  });

  it('requires confirm when a move leaves too little rest, then accepts it with confirm: true', async () => {
    // computeTimeline пересчитывает время у всего расписания, а не только у переставленных схваток (раздел 3),
    // и — в отличие от автопланировщика — не закладывает минимальный отдых между зависимыми схватками, только
    // предупреждает о нём постфактум. Поэтому у свежесгенерированного расписания категории cat1 (с реальными
    // зависимостями, см. readyWorld) уже есть такие предупреждения ещё до какой-либо ручной правки — и платим
    // пакетом движением двух совершенно не связанных с ними схваток cat2 (круговая система, независимы друг от
    // друга), тоже требует confirm именно из-за них.
    const { w, session, cat2 } = await readyWorld();
    await generate(w.staff.manager, w.competitionId, {});
    const schedule = await getSchedule(w.staff.manager, w.competitionId);
    const cat2Items = schedule.items.filter((i) => i.categoryId === cat2.categoryId).sort((a, b) => a.orderInMat - b.orderInMat);
    const [a, b] = cat2Items;
    const moves = [
      { matchId: a!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: b!.orderInMat },
      { matchId: b!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: a!.orderInMat },
    ];

    const refused = await send(
      w.staff.manager,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      { moves },
      schedule.version,
    );
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error.code).toBe('SCHEDULE_CONFIRM_REQUIRED');
    const warnings = refused.body.error.details.warnings as { matchId: string; kind: string }[];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatchObject({ matchId: expect.any(String), kind: expect.stringMatching(/^(rest_dependency|rest_athlete|session_overflow)$/) });

    const confirmed = await send(
      w.staff.manager,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      { moves, confirm: true },
      schedule.version,
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const data = confirmed.body.data as ScheduleDto;
    expect(data.warnings.length).toBeGreaterThan(0);
  });
});

describe('publication and the DRAWING → SCHEDULED transition', () => {
  it('refuses to publish while matches are unassigned, and blocks publication by staff without schedule.publish', async () => {
    const { w } = await readyWorld();
    const empty = await getSchedule(w.staff.manager, w.competitionId);
    const r = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/schedule/publish`, {}, empty.version);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SCHEDULE_HAS_UNASSIGNED_MATCHES');

    await generate(w.staff.secretary, w.competitionId, {});
    const ready = await getSchedule(w.staff.manager, w.competitionId);
    const bySecretary = await send(
      w.staff.secretary,
      'post',
      `/api/v1/competitions/${w.competitionId}/schedule/publish`,
      {},
      ready.version,
    );
    expect(bySecretary.status).toBe(403);
  });

  it('publishes, moves DRAWING → SCHEDULED, blocks the transition before publication, and refuses re-publication', async () => {
    const { w } = await readyWorld();
    const competition0 = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const blocked = await send(
      w.staff.manager,
      'post',
      `/api/v1/competitions/${w.competitionId}/transitions`,
      { to: 'SCHEDULED' },
      competition0.version,
    );
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.failed).toContain('schedule_not_published');

    await generate(w.staff.manager, w.competitionId, {});
    const ready = await getSchedule(w.staff.manager, w.competitionId);
    const r = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/schedule/publish`, {}, ready.version);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'PUBLISHED' });
    expect(r.body.data.publishedBy?.displayName).toBeTruthy();

    const events = await t.admin.outboxEvent.findMany({
      where: { competitionId: w.competitionId, type: 'schedule.published' },
    });
    expect(events).toHaveLength(1);
    const audit = await t.admin.auditLog.findFirst({ where: { action: 'schedule.published', competitionId: w.competitionId } });
    expect(audit).not.toBeNull();

    const again = await send(
      w.staff.manager,
      'post',
      `/api/v1/competitions/${w.competitionId}/schedule/publish`,
      {},
      r.body.data.version,
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SCHEDULE_ALREADY_PUBLISHED');

    const competition1 = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const transitioned = await send(
      w.staff.manager,
      'post',
      `/api/v1/competitions/${w.competitionId}/transitions`,
      { to: 'SCHEDULED' },
      competition1.version,
    );
    expect(transitioned.status, JSON.stringify(transitioned.body)).toBe(200);
    expect(transitioned.body.data.status).toBe('SCHEDULED');
  });
});

describe('changing the schedule after publication', () => {
  it('enqueues one schedule.changed event for the clubs, merging every match moved in the batch', async () => {
    const { w, session, cat2 } = await readyWorld();
    await generate(w.staff.manager, w.competitionId, {});
    const before = await getSchedule(w.staff.manager, w.competitionId);
    await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/schedule/publish`, {}, before.version);

    const published = await getSchedule(w.staff.manager, w.competitionId);
    const cat2Items = published.items
      .filter((i) => i.categoryId === cat2.categoryId)
      .sort((a, b) => a.orderInMat - b.orderInMat);
    const [a, b] = cat2Items;

    const move = await send(
      w.staff.secretary,
      'patch',
      `/api/v1/competitions/${w.competitionId}/schedule/items`,
      {
        moves: [
          { matchId: a!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: b!.orderInMat },
          { matchId: b!.matchId, sessionId: session.id, matId: a!.matId, orderInMat: a!.orderInMat },
        ],
        confirm: true,
      },
      published.version,
    );
    expect(move.status, JSON.stringify(move.body)).toBe(200);

    const events = await t.admin.outboxEvent.findMany({
      where: { competitionId: w.competitionId, type: 'schedule.changed' },
    });
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as { competitionId: string; matchIds: string[] };
    expect(new Set(payload.matchIds)).toEqual(new Set([a!.matchId, b!.matchId]));
  });
});

describe('a new draw version removes its matches from the schedule', () => {
  it('clears the schedule rows of a superseded draw and reports its matches as unassigned again', async () => {
    const { w, cat2 } = await readyWorld();
    await generate(w.staff.manager, w.competitionId, {});
    const before = await getSchedule(w.staff.manager, w.competitionId);
    expect(before.unassigned).toEqual([]);
    const cat2MatchIds = (await t.admin.match.findMany({ where: { categoryId: cat2.categoryId }, select: { id: true } })).map(
      (m) => m.id,
    );
    expect(cat2MatchIds.length).toBeGreaterThan(0);
    expect(cat2MatchIds.every((id) => before.items.some((i) => i.matchId === id))).toBe(true);

    const publishedDraw = await t.admin.draw.findFirstOrThrow({ where: { categoryId: cat2.categoryId, status: 'PUBLISHED' } });
    const supersede = await send(
      w.staff.chief,
      'post',
      `/api/v1/draws/${publishedDraw.id}/supersede`,
      { reason: 'Ошибка в посеве' },
      publishedDraw.version,
    );
    expect(supersede.status, JSON.stringify(supersede.body)).toBe(200);

    expect(await t.admin.matchSchedule.count({ where: { matchId: { in: cat2MatchIds } } })).toBe(0);
    const after = await getSchedule(w.staff.manager, w.competitionId);
    expect(after.items.some((i) => cat2MatchIds.includes(i.matchId))).toBe(false);
  });
});

describe('mat crews', () => {
  it('lists tournament staff as candidates, assigns a crew, blocks double-booking on another mat, and copies to a new session', async () => {
    const { w, mats, session } = await readyWorld();
    const candidates = await w.staff.manager.agent.get(`/api/v1/competitions/${w.competitionId}/crew-candidates`);
    expect(candidates.status).toBe(200);
    const rows = candidates.body.data as CrewCandidateDto[];
    expect(new Set(rows.map((c) => c.roleCode))).toEqual(new Set(['SECRETARY', 'CHIEF_REFEREE']));
    const secretaryCandidate = rows.find((c) => c.roleCode === 'SECRETARY')!;

    const put = await send(w.staff.manager, 'put', `/api/v1/competitions/${w.competitionId}/mat-assignments`, {
      sessionId: session.id,
      matId: mats[0]!.id,
      assignments: [{ role: 'MAT_CHIEF', userId: secretaryCandidate.id }],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.data).toHaveLength(1);
    expect(put.body.data[0]).toMatchObject({ role: 'MAT_CHIEF', user: { id: secretaryCandidate.id } });

    // Один человек не может стоять на двух коврах одной сессии одновременно.
    const conflict = await send(w.staff.chief, 'put', `/api/v1/competitions/${w.competitionId}/mat-assignments`, {
      sessionId: session.id,
      matId: mats[1]!.id,
      assignments: [{ role: 'MAT_CHIEF', userId: secretaryCandidate.id }],
    });
    expect(conflict.status).toBe(422);
    expect(conflict.body.error.code).toBe('MAT_ASSIGNMENT_CONFLICT');

    // schedule.manage (секретарь) не включает mat_assignment.manage.
    const bySecretary = await send(w.staff.secretary, 'put', `/api/v1/competitions/${w.competitionId}/mat-assignments`, {
      sessionId: session.id,
      matId: mats[1]!.id,
      assignments: [],
    });
    expect(bySecretary.status).toBe(403);

    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const day = isoDate(competition.startDate);
    const afternoon = await createSession(w.staff.manager, w.competitionId, 'День', `${day}T16:30:00.000Z`, `${day}T20:00:00.000Z`);
    const copy = await send(w.staff.chief, 'post', `/api/v1/competitions/${w.competitionId}/mat-assignments/copy`, {
      fromSessionId: session.id,
      toSessionId: afternoon.id,
    });
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);

    const list = await w.staff.chief.agent.get(`/api/v1/competitions/${w.competitionId}/mat-assignments`);
    expect((list.body.data as MatAssignmentDto[]).filter((a) => a.sessionId === afternoon.id)).toHaveLength(1);
  });

  it('keeps exactly one assignment under concurrent PUTs to the same session (advisory lock, crews.service.ts)', async () => {
    const { w, mats, session } = await readyWorld();
    const candidates = await w.staff.manager.agent.get(`/api/v1/competitions/${w.competitionId}/crew-candidates`);
    const secretaryCandidate = (candidates.body.data as CrewCandidateDto[]).find((c) => c.roleCode === 'SECRETARY')!;

    // Один и тот же человек — двумя параллельными PUT на разные ковры одной сессии (план §5: один человек — на
    // одном ковре сессии). `assertNoDoubleBooking` сама по себе — обычный SELECT (не атомарна с последующей
    // записью), поэтому её безопасность под конкурентной нагрузкой держится на `lockSessionCrews` — advisory-
    // блокировке по сессии, сериализующей обе команды. Через HTTP/Promise.all в этом тестовом стенде само окно
    // гонки обычно не попадает в кадр (слишком много последовательных await до критической секции), поэтому тест
    // не ловит регрессию при отсутствии блокировки — он фиксирует итоговый инвариант (ровно одно назначение),
    // а не доказывает факт сериализации; корректность самой блокировки проверена вручную при разработке.
    const [a, b] = await Promise.all([
      send(w.staff.manager, 'put', `/api/v1/competitions/${w.competitionId}/mat-assignments`, {
        sessionId: session.id,
        matId: mats[0]!.id,
        assignments: [{ role: 'MAT_CHIEF', userId: secretaryCandidate.id }],
      }),
      send(w.staff.chief, 'put', `/api/v1/competitions/${w.competitionId}/mat-assignments`, {
        sessionId: session.id,
        matId: mats[1]!.id,
        assignments: [{ role: 'MAT_CHIEF', userId: secretaryCandidate.id }],
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const failed = [a, b].find((r) => r.status === 422);
    expect(failed?.body.error.code).toBe('MAT_ASSIGNMENT_CONFLICT');

    const rows = await t.admin.matAssignment.findMany({
      where: { competitionId: w.competitionId, sessionId: session.id, userId: secretaryCandidate.id },
    });
    expect(rows).toHaveLength(1);
  });
});

describe('mat queue screen', () => {
  it('shows the current and next scheduled matches of a mat', async () => {
    const { w, cat2 } = await readyWorld();
    await generate(w.staff.manager, w.competitionId, {});
    const schedule = await getSchedule(w.staff.manager, w.competitionId);
    const cat2Items = schedule.items.filter((i) => i.categoryId === cat2.categoryId).sort((a, b) => a.orderInMat - b.orderInMat);
    const matId = cat2Items[0]!.matId;

    const queue = await w.staff.manager.agent.get(`/api/v1/mats/${matId}/queue`);
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    const data = queue.body.data as MatQueueDto;
    expect(data.current?.matchId).toBe(cat2Items[0]!.matchId);
    expect(data.next.map((m) => m.matchId)).toEqual(cat2Items.slice(1, 4).map((i) => i.matchId));

    const outsider = await w.staff.outsider.agent.get(`/api/v1/mats/${matId}/queue`);
    expect([403, 404]).toContain(outsider.status);
  });
});

/** Тренер клуба — владелец заявки (APPLICATION_OWNER), без турнирной должности. */
async function coachSessionFor(organizationId: string): Promise<Session> {
  const user = await createUser(t, { orgs: [{ organizationId, role: 'COACH' }] });
  return login(t, user.email);
}

describe('club application view (план §6/§8)', () => {
  it('shows mat, match number and planned time in the club application only after publish', async () => {
    const { w, cat1 } = await readyWorld();
    const entryRow = await t.admin.entry.findFirstOrThrow({ where: { categoryId: cat1.categoryId } });
    const coach = await coachSessionFor(entryRow.snapClubId as string);

    const beforePublish = await coach.agent.get(`/api/v1/applications/${entryRow.applicationId}`);
    expect(beforePublish.status, JSON.stringify(beforePublish.body)).toBe(200);
    const entryBefore = beforePublish.body.data.entries.find((e: { id: string }) => e.id === entryRow.id);
    expect(entryBefore.scheduledMatches).toEqual([]);

    await generate(w.staff.manager, w.competitionId, {});
    const ready = await getSchedule(w.staff.manager, w.competitionId);
    const published = await send(
      w.staff.manager,
      'post',
      `/api/v1/competitions/${w.competitionId}/schedule/publish`,
      {},
      ready.version,
    );
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const afterPublish = await coach.agent.get(`/api/v1/applications/${entryRow.applicationId}`);
    expect(afterPublish.status, JSON.stringify(afterPublish.body)).toBe(200);
    const entryAfter = afterPublish.body.data.entries.find((e: { id: string }) => e.id === entryRow.id);
    expect(entryAfter.scheduledMatches.length).toBeGreaterThan(0);
    const scheduledMatch = entryAfter.scheduledMatches[0];
    expect(scheduledMatch).toMatchObject({
      matchId: expect.any(String),
      matNumber: expect.any(Number),
      plannedAt: expect.any(String),
    });
    const scheduleItem = (published.body.data as ScheduleDto).items.find(
      (i) => i.matchId === scheduledMatch.matchId,
    );
    expect(scheduleItem).toBeDefined();
    expect(scheduledMatch.plannedAt).toBe(scheduleItem!.plannedAt);
    expect(scheduledMatch.matNumber).toBe((await t.admin.mat.findUniqueOrThrow({ where: { id: scheduleItem!.matId } })).number);

    // Другой клуб заявки не видит — изоляция по заявке, как и у остальных полей EntryDto.
    const otherClubId = w.clubs.find((c) => c !== entryRow.snapClubId) as string;
    const otherCoach = await coachSessionFor(otherClubId);
    const forbidden = await otherCoach.agent.get(`/api/v1/applications/${entryRow.applicationId}`);
    expect([403, 404]).toContain(forbidden.status);
  });
});

describe('sync log', () => {
  it('registers every scheduling table for change data capture', async () => {
    const rows = await t.admin.syncLog.groupBy({ by: ['tableName'], _count: true });
    const tables = new Set(rows.map((r) => r.tableName));
    for (const table of ['mat', 'session', 'schedule', 'match_schedule', 'mat_assignment']) expect(tables).toContain(table);
  });
});
