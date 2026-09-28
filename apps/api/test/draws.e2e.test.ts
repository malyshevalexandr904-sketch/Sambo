// Жеребьёвка и сетки (Phase 5a): черновик по допущенным участникам, воспроизводимость по seed, отчёт о разведении,
// публикация (сетка, схватки, BYE, категория → DRAWN), новая версия с причиной, неизменяемость опубликованной
// жеребьёвки в БД (раздел 53), движок продвижения по сетке с утешительными схватками.
import type { BracketNodeDto, CategoryBracketDto, DrawDto } from '@sde/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BracketsService } from '../src/modules/brackets';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp, resetData, type Session, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import {
  type CategoryFixture,
  drawCategory,
  drawWorld,
  type DrawWorld,
  SEED_A,
  SEED_B,
} from './helpers/phase5';

let t: TestApp;
let w: DrawWorld;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  w = await drawWorld(t);
});
afterAll(async () => {
  await t.close();
});

const createDraft = (s: Session, categoryId: string, body: Record<string, unknown> = {}) =>
  send(s, 'post', `/api/v1/categories/${categoryId}/draws`, body);

async function draft(s: Session, categoryId: string, body: Record<string, unknown> = {}): Promise<DrawDto> {
  const r = await createDraft(s, categoryId, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as DrawDto;
}

async function publish(s: Session, d: DrawDto): Promise<DrawDto> {
  const r = await send(s, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as DrawDto;
}

async function bracketOf(s: Session, categoryId: string): Promise<CategoryBracketDto> {
  const r = await s.agent.get(`/api/v1/categories/${categoryId}/brackets`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as CategoryBracketDto;
}

describe('draft', () => {
  let cat: CategoryFixture;
  beforeAll(async () => {
    cat = await drawCategory(t, w, 10);
  });

  it('shows the category ready for the draw with the format chosen by the rules', async () => {
    const r = await w.staff.manager.agent.get(`/api/v1/categories/${cat.categoryId}/draws`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      admitted: 10,
      admissionPending: 0,
      suggestedFormat: 'ELIMINATION_WITH_REPECHAGE',
      draws: [],
      allowedActions: ['draw.create'],
    });
    expect(r.body.data.participants).toHaveLength(10);
    expect(r.body.data.participants.map((p: { entryId: string }) => p.entryId)).not.toContain(
      cat.notAdmitted,
    );
    const overview = await w.staff.secretary.agent.get(`/api/v1/competitions/${w.competitionId}/draws`);
    expect(overview.status).toBe(200);
    expect(
      overview.body.data.find((x: { category: { id: string } }) => x.category.id === cat.categoryId),
    ).toMatchObject({
      admitted: 10,
      published: null,
      drafts: 0,
    });
  });

  it('draws admitted entries only, with BYEs, pools and a separation report', async () => {
    const d = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A });
    expect(d).toMatchObject({
      number: 1,
      status: 'DRAFT',
      format: 'ELIMINATION_WITH_REPECHAGE',
      algorithmVersion: 'draw-v1',
      randomSeed: SEED_A,
      participants: 10,
      stale: false,
    });
    expect(d.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.allowedActions).toEqual(['draw.verify', 'draw.publish']);
    expect(d.slots).toHaveLength(16);
    expect(d.slots.filter((s) => s.entryId === null)).toHaveLength(6);
    expect(d.slots.every((s) => s.pool === (s.position <= 8 ? 'A' : 'B'))).toBe(true);
    const placed = d.slots.flatMap((s) => (s.entryId ? [s.entryId] : []));
    expect(placed.sort()).toEqual([...cat.entries].sort());
    expect(placed).not.toContain(cat.notAdmitted);
    expect(d.separation.applicable).toBe(true);
    expect(d.separation.unmet).toBe(0);
    expect(d.separation.groups.filter((g) => g.key === 'ORGANIZATION')).toHaveLength(3);
    expect(d.separation.groups.every((g) => g.name)).toBe(true);
    // Предпросмотр: 15 узлов основной сетки и 4 утешительных, схваток ещё нет, BYE решены.
    expect(d.bracket.nodes).toHaveLength(19);
    expect(d.bracket.nodes.every((n) => n.match === null)).toBe(true);
    expect(d.bracket.nodes.filter((n) => n.status === 'WALKOVER')).toHaveLength(6);
    expect(d.bracket.participants).toHaveLength(10);
    expect(d.bracket.participants[0]).toMatchObject({
      publicName: expect.stringMatching(/ И\.$/),
      entryStatus: 'APPROVED',
    });
  });

  it('repeats the same layout with the same seed and verifies it', async () => {
    const first = (await t.admin.draw.findFirstOrThrow({ where: { categoryId: cat.categoryId, number: 1 } }))
      .id;
    const again = await draft(w.staff.secretary, cat.categoryId, { randomSeed: SEED_A });
    const original = (await w.staff.manager.agent.get(`/api/v1/draws/${first}`)).body.data as DrawDto;
    expect(again.number).toBe(2);
    expect(again.inputHash).toBe(original.inputHash);
    expect(again.slots).toEqual(original.slots);
    const other = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_B });
    expect(other.inputHash).toBe(original.inputHash);
    expect(other.slots).not.toEqual(original.slots);
    const v = await send(w.staff.manager, 'post', `/api/v1/draws/${first}/verify`);
    expect(v.status).toBe(200);
    expect(v.body.data).toEqual({
      reproducible: true,
      inputHashMatches: true,
      slotsMatch: true,
      currentInput: true,
      algorithmVersion: 'draw-v1',
    });
  });

  it('generates a random seed when none is given and marks a manual one', async () => {
    const d = await draft(w.staff.manager, cat.categoryId);
    expect(d.randomSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(d.randomSeed).not.toBe(SEED_A);
    expect(d.manualSeed).toBe(false);
    const manual = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A });
    expect(manual.manualSeed).toBe(true);
    const audit = await t.admin.auditLog.findFirstOrThrow({
      where: { action: 'draw.created', entityId: manual.id },
    });
    expect(audit.after).toMatchObject({ randomSeed: SEED_A, manualSeed: true });
  });

  it('validates format, seeding and seed', async () => {
    const unsupported = await createDraft(w.staff.manager, cat.categoryId, { format: 'DOUBLE_ELIMINATION' });
    expect(unsupported.status).toBe(400);
    const seeding = await createDraft(w.staff.manager, cat.categoryId, {
      seeding: [
        { entryId: cat.notAdmitted, seedNumber: 1 },
        { entryId: cat.entries[0], seedNumber: 11 },
      ],
    });
    expect(seeding.status).toBe(400);
    expect(seeding.body.error.details.fields).toEqual([
      { path: 'seeding.0.entryId', code: 'not_admitted' },
      { path: 'seeding.1.seedNumber', code: 'out_of_range' },
    ]);
    const zero = await createDraft(w.staff.manager, cat.categoryId, { randomSeed: '0'.repeat(32) });
    expect(zero.status).toBe(400);
  });

  it('puts seeded athletes on seed positions and gives them the BYEs', async () => {
    const d = await draft(w.staff.manager, cat.categoryId, {
      randomSeed: SEED_B,
      seeding: [
        { entryId: cat.entries[3], seedNumber: 1 },
        { entryId: cat.entries[7], seedNumber: 2 },
      ],
    });
    const pos = (id: string | undefined) => d.slots.find((s) => s.entryId === id)?.position;
    expect(pos(cat.entries[3])).toBe(1);
    expect(pos(cat.entries[7])).toBe(9);
    expect(d.slots[1]?.entryId).toBeNull();
    expect(d.slots[9]?.entryId).toBeNull();
  });

  it('allows drafts to staff with draw.create only', async () => {
    const r = await createDraft(w.staff.outsider, cat.categoryId, {});
    expect([403, 404]).toContain(r.status);
    const list = await w.staff.outsider.agent.get(`/api/v1/categories/${cat.categoryId}/draws`);
    expect([403, 404]).toContain(list.status);
    const chief = await draft(w.staff.chief, cat.categoryId, { randomSeed: SEED_A });
    expect(chief.allowedActions).toEqual(['draw.verify', 'draw.publish']);
    const secretaryView = await w.staff.secretary.agent.get(`/api/v1/draws/${chief.id}`);
    expect(secretaryView.body.data.allowedActions).toEqual(['draw.verify']);
  });
});

describe('preconditions', () => {
  it('requires a category ready for the draw and the draw stage of the competition', async () => {
    const weighIn = await drawCategory(t, w, 4, { status: 'WEIGH_IN' });
    const r = await createDraft(w.staff.manager, weighIn.categoryId);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'CATEGORY_NOT_READY_FOR_DRAW',
      details: { status: 'WEIGH_IN' },
    });

    const single = await drawCategory(t, w, 1);
    const one = await createDraft(w.staff.manager, single.categoryId);
    expect(one.status).toBe(422);
    expect(one.body.error).toMatchObject({ code: 'DRAW_NOT_ENOUGH_PARTICIPANTS', details: { admitted: 1 } });

    const early = await drawWorld(t, { status: 'CHECK_IN' });
    const earlyCat = await drawCategory(t, early, 4);
    const tooEarly = await createDraft(early.staff.manager, earlyCat.categoryId);
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['competition_status'] },
    });
  });
});

describe('publication', () => {
  let cat: CategoryFixture;
  let d: DrawDto;
  beforeAll(async () => {
    cat = await drawCategory(t, w, 10);
    d = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A });
  });

  it('requires If-Match, the current version and draw.publish', async () => {
    const noVersion = await send(w.staff.manager, 'post', `/api/v1/draws/${d.id}/publish`, {});
    expect(noVersion.status).toBe(400);
    expect(noVersion.body.error.code).toBe('VERSION_REQUIRED');
    const stale = await send(w.staff.manager, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version + 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const secretary = await send(w.staff.secretary, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version);
    expect(secretary.status).toBe(403);
  });

  it('refuses a draft whose participants changed since it was drawn', async () => {
    await t.admin.admission.update({ where: { entryId: cat.entries[0] }, data: { status: 'NOT_ADMITTED' } });
    const view = (await w.staff.manager.agent.get(`/api/v1/draws/${d.id}`)).body.data as DrawDto;
    expect(view.stale).toBe(true);
    expect(view.allowedActions).toEqual(['draw.verify']);
    const r = await send(w.staff.manager, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['draw_input_changed'] },
    });
    const verify = await send(w.staff.manager, 'post', `/api/v1/draws/${d.id}/verify`);
    expect(verify.body.data).toMatchObject({ reproducible: true, currentInput: false });
    await t.admin.admission.update({ where: { entryId: cat.entries[0] }, data: { status: 'ADMITTED' } });
  });

  it('creates the bracket, numbered matches and resolved BYEs, and moves the category to DRAWN', async () => {
    const before = await t.admin.match.aggregate({
      where: { competitionId: w.competitionId },
      _max: { matchNumber: true },
    });
    const published = await publish(w.staff.manager, d);
    expect(published).toMatchObject({ status: 'PUBLISHED', number: 1, allowedActions: ['draw.verify'] });
    expect(published.publishedBy?.displayName).toBeTruthy();
    const category = await t.admin.competitionCategory.findUniqueOrThrow({ where: { id: cat.categoryId } });
    expect(category.status).toBe('DRAWN');

    const b = await bracketOf(w.staff.secretary, cat.categoryId);
    expect(b.draw?.id).toBe(d.id);
    const nodes = b.bracket?.nodes as BracketNodeDto[];
    expect(nodes).toHaveLength(19);
    expect(nodes.every((n) => n.match !== null)).toBe(true);
    const byes = nodes.filter((n) => n.status === 'WALKOVER');
    expect(byes).toHaveLength(6);
    for (const n of byes)
      expect(n.match).toMatchObject({ status: 'FINISHED', number: null, winnerSide: n.winnerSide });
    const numbered = nodes.flatMap((n) => (n.match?.number ? [n.match.number] : [])).sort((a, b) => a - b);
    const first = (before._max.matchNumber ?? 0) + 1;
    expect(numbered).toEqual(Array.from({ length: 13 }, (_, i) => first + i));
    // Финал — последним номером; утешительные — 150 с, основная сетка — по возрасту категории.
    const final = nodes.find((n) => n.label === 'FINAL');
    expect(final?.match?.number).toBe(first + 12);
    expect(nodes.find((n) => n.label === 'BRONZE')?.match?.durationSeconds).toBe(150);
    expect(final?.match?.durationSeconds).toBe(180);
    // Победители BYE уже стоят в своих схватках второго круга.
    const secondRound = nodes.filter((n) => n.stage === 'MAIN' && n.round === 2);
    expect(secondRound.some((n) => n.red.entryId || n.blue.entryId)).toBe(true);

    const events = await t.admin.outboxEvent.findMany({ where: { competitionId: w.competitionId } });
    expect(events.some((e) => e.type === 'draw.published')).toBe(true);
    expect(events.some((e) => e.type === 'category.status_changed')).toBe(true);
    const audit = await t.admin.auditLog.findFirst({ where: { action: 'draw.published', entityId: d.id } });
    expect(audit).not.toBeNull();
    const sync = await t.admin.syncLog.groupBy({
      by: ['tableName'],
      where: { competitionId: w.competitionId },
      _count: true,
    });
    const tables = sync.map((s) => s.tableName);
    for (const table of ['draw', 'draw_slot', 'bracket', 'bracket_node', 'match', 'match_participant'])
      expect(tables).toContain(table);
  });

  it('allows only one published draw per category', async () => {
    const other = await t.admin.draw.findFirst({ where: { categoryId: cat.categoryId, status: 'DRAFT' } });
    expect(other).toBeNull();
    const again = await createDraft(w.staff.manager, cat.categoryId, { randomSeed: SEED_B });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('DRAW_ALREADY_PUBLISHED');
    const republish = await send(w.staff.manager, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version + 1);
    expect(republish.status).toBe(422);
    expect(republish.body.error.code).toBe('DRAW_ALREADY_PUBLISHED');
  });

  it('keeps the published draw and its slots immutable in the database', async () => {
    await expect(
      t.admin.draw.update({ where: { id: d.id }, data: { randomSeed: SEED_B } }),
    ).rejects.toThrow();
    await expect(
      t.admin.drawSlot.updateMany({ where: { drawId: d.id, position: 1 }, data: { seedNumber: 5 } }),
    ).rejects.toThrow();
    await expect(t.admin.drawSlot.deleteMany({ where: { drawId: d.id } })).rejects.toThrow();
    await expect(t.admin.draw.delete({ where: { id: d.id } })).rejects.toThrow();
    await expect(
      t.admin.$executeRaw`UPDATE draw SET status = 'DRAFT' WHERE id = ${d.id}::uuid`,
    ).rejects.toThrow();
  });

  it('keeps the competition from returning to check-in while draws are published', async () => {
    const c = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const r = await send(
      w.staff.manager,
      'post',
      `/api/v1/competitions/${w.competitionId}/transitions`,
      { to: 'CHECK_IN', reason: 'Повторная мандатная комиссия' },
      c.version,
    );
    expect(r.status).toBe(422);
    expect(r.body.error.details.failed).toContain('draws_published');
  });
});

describe('which draft can be published', () => {
  it('publishes only the newest draft of the category', async () => {
    const cat = await drawCategory(t, w, 6);
    const older = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A });
    const newer = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_B });
    const view = (await w.staff.manager.agent.get(`/api/v1/draws/${older.id}`)).body.data as DrawDto;
    expect(view.allowedActions).toEqual(['draw.verify']);
    const list = await w.staff.manager.agent.get(`/api/v1/categories/${cat.categoryId}/draws`);
    const actions = new Map(
      (list.body.data.draws as DrawDto[]).map((d) => [d.id, d.allowedActions] as const),
    );
    expect(actions.get(older.id)).toEqual(['draw.verify']);
    expect(actions.get(newer.id)).toEqual(['draw.verify', 'draw.publish']);
    const r = await send(w.staff.manager, 'post', `/api/v1/draws/${older.id}/publish`, {}, older.version);
    expect(r.status).toBe(422);
    expect(r.body.error.details.failed).toEqual(['newer_draft_exists']);
    await publish(w.staff.manager, newer);
  });

  it('waits until admission is decided for every entry of the category', async () => {
    const cat = await drawCategory(t, w, 6);
    const d = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A });
    // После готовности категории документ вернули на проверку: допуск одного спортсмена снова не решён.
    await t.admin.admission.update({ where: { entryId: cat.entries[0] }, data: { status: 'PENDING' } });
    const list = await w.staff.manager.agent.get(`/api/v1/categories/${cat.categoryId}/draws`);
    expect(list.body.data).toMatchObject({ admissionPending: 1, allowedActions: [] });
    const view = (await w.staff.manager.agent.get(`/api/v1/draws/${d.id}`)).body.data as DrawDto;
    expect(view.allowedActions).toEqual(['draw.verify']);
    for (const r of [
      await createDraft(w.staff.manager, cat.categoryId, { randomSeed: SEED_B }),
      await send(w.staff.manager, 'post', `/api/v1/draws/${d.id}/publish`, {}, d.version),
    ]) {
      expect(r.status).toBe(422);
      expect(r.body.error.details.failed).toEqual(['admission_pending']);
    }
    await t.admin.admission.update({ where: { entryId: cat.entries[0] }, data: { status: 'ADMITTED' } });
    await publish(w.staff.manager, d);
  });
});

describe('new version of a published draw', () => {
  let cat: CategoryFixture;
  let d: DrawDto;
  beforeAll(async () => {
    cat = await drawCategory(t, w, 7);
    d = await publish(w.staff.manager, await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A }));
  });

  it('is only for draw.republish, with If-Match and a reason', async () => {
    const manager = await send(
      w.staff.manager,
      'post',
      `/api/v1/draws/${d.id}/supersede`,
      { reason: 'Ошибка в посеве' },
      d.version,
    );
    expect(manager.status).toBe(403);
    const noReason = await send(w.staff.chief, 'post', `/api/v1/draws/${d.id}/supersede`, {}, d.version);
    expect(noReason.status).toBe(400);
    const noVersion = await send(w.staff.chief, 'post', `/api/v1/draws/${d.id}/supersede`, {
      reason: 'Ошибка в посеве',
    });
    expect(noVersion.status).toBe(400);
  });

  it('waits until admission is decided again (the category returns to READY_FOR_DRAW)', async () => {
    // После публикации положение потребовало взвешивания: допуск снова не решён — к жеребьёвке категорию не вернуть.
    const requirement = await t.admin.competitionRequirement.create({
      data: { competitionId: w.competitionId, categoryId: cat.categoryId, kind: 'WEIGH_IN', mandatory: true },
    });
    const view = (await w.staff.chief.agent.get(`/api/v1/draws/${d.id}`)).body.data as DrawDto;
    const r = await send(
      w.staff.chief,
      'post',
      `/api/v1/draws/${d.id}/supersede`,
      { reason: 'Ошибка в посеве' },
      view.version,
    );
    expect(r.status).toBe(422);
    expect(r.body.error.details.failed).toEqual(['admission_pending']);
    expect((await t.admin.draw.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('PUBLISHED');
    await t.admin.competitionRequirement.delete({ where: { id: requirement.id } });
    await t.admin.admission.updateMany({
      where: { entryId: { in: cat.entries } },
      data: { status: 'ADMITTED' },
    });
  });

  it('removes the bracket, returns the category to READY_FOR_DRAW and allows a new version', async () => {
    const view = (await w.staff.chief.agent.get(`/api/v1/draws/${d.id}`)).body.data as DrawDto;
    expect(view.allowedActions).toEqual(['draw.verify', 'draw.supersede']);
    const r = await send(
      w.staff.chief,
      'post',
      `/api/v1/draws/${d.id}/supersede`,
      { reason: 'Ошибка в посеве' },
      view.version,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'SUPERSEDED', supersedeReason: 'Ошибка в посеве' });
    expect(
      (await t.admin.competitionCategory.findUniqueOrThrow({ where: { id: cat.categoryId } })).status,
    ).toBe('READY_FOR_DRAW');
    expect(await t.admin.match.count({ where: { categoryId: cat.categoryId } })).toBe(0);
    expect(await t.admin.bracket.count({ where: { categoryId: cat.categoryId } })).toBe(0);
    // Слоты заменённой версии сохраняются: жеребьёвку можно проверить и после замены.
    expect(await t.admin.drawSlot.count({ where: { drawId: d.id } })).toBe(8);
    expect((await bracketOf(w.staff.manager, cat.categoryId)).draw).toBeNull();
    const audit = await t.admin.auditLog.findFirst({ where: { action: 'draw.superseded', entityId: d.id } });
    expect(audit?.reason).toBe('Ошибка в посеве');

    const next = await publish(
      w.staff.manager,
      await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_B }),
    );
    expect(next).toMatchObject({ number: 2, status: 'PUBLISHED' });
    const repeat = await send(
      w.staff.chief,
      'post',
      `/api/v1/draws/${d.id}/supersede`,
      { reason: 'Ещё раз' },
      r.body.data.version,
    );
    expect(repeat.status).toBe(422);
    expect(repeat.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('round robin', () => {
  it('builds every pair once, without BYEs', async () => {
    const cat = await drawCategory(t, w, 5);
    const d = await publish(
      w.staff.manager,
      await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A }),
    );
    expect(d.format).toBe('ROUND_ROBIN');
    expect(d.separation.applicable).toBe(false);
    const nodes = (await bracketOf(w.staff.manager, cat.categoryId)).bracket?.nodes as BracketNodeDto[];
    expect(nodes).toHaveLength(10);
    expect(nodes.every((n) => n.status === 'READY' && n.match?.number)).toBe(true);
    const pairs = new Set(nodes.map((n) => [n.red.entryId, n.blue.entryId].sort().join('|')));
    expect(pairs.size).toBe(10);
  });

  it('follows the category format override', async () => {
    const cat = await drawCategory(t, w, 6, { formatOverride: 'ROUND_ROBIN' });
    const d = await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A });
    expect(d.format).toBe('ROUND_ROBIN');
    const single = await draft(w.staff.manager, cat.categoryId, {
      randomSeed: SEED_A,
      format: 'SINGLE_ELIMINATION',
    });
    expect(single.format).toBe('SINGLE_ELIMINATION');
    expect(single.slots).toHaveLength(8);
  });
});

describe('progression engine (called by Phase 7 on a confirmed result)', () => {
  let cat: CategoryFixture;
  let brackets: BracketsService;
  let db: PrismaService;
  beforeAll(async () => {
    cat = await drawCategory(t, w, 7);
    await publish(w.staff.manager, await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_B }));
    brackets = t.app.get(BracketsService);
    db = t.app.get(PrismaService);
  });

  const nodes = async (): Promise<BracketNodeDto[]> =>
    (await bracketOf(w.staff.manager, cat.categoryId)).bracket?.nodes as BracketNodeDto[];

  it('refuses a result for a match whose opponent is not known yet', async () => {
    const pending = (await nodes()).find((n) => n.label === 'FINAL');
    await expect(
      db.tx((tx) => brackets.applyConfirmedResult(tx, pending?.match?.id as string, 'RED')),
    ).rejects.toMatchObject({ code: 'MATCH_PARTICIPANTS_INCOMPLETE' });
  });

  it('advances winners, fills the repechage after the pool finals and blocks a new draw version', async () => {
    const numbers = new Map((await nodes()).map((n) => [n.match?.id, n.match?.number ?? null]));
    for (let guard = 0; guard < 20; guard++) {
      const ready = (await nodes()).filter((n) => n.status === 'READY');
      if (ready.length === 0) break;
      for (const n of ready)
        await db.tx((tx) => brackets.applyConfirmedResult(tx, n.match?.id as string, 'RED'));
    }
    const all = await nodes();
    expect(all.every((n) => n.status === 'DECIDED' || n.status === 'WALKOVER')).toBe(true);
    // Номера, выданные при публикации, не меняются — и у схватки, оставшейся без соперника.
    for (const n of all) expect(n.match?.number ?? null).toBe(numbers.get(n.match?.id));
    const final = all.find((n) => n.label === 'FINAL');
    expect(final?.match).toMatchObject({ status: 'FINISHED', winnerSide: 'RED' });
    const bronze = all.filter((n) => n.label === 'BRONZE');
    expect(bronze).toHaveLength(2);
    // В утешительных — проигравшие победителям подгрупп: стороны заполнены участниками категории.
    for (const n of bronze) {
      for (const id of [n.red.entryId, n.blue.entryId].filter(Boolean)) expect(cat.entries).toContain(id);
    }
    const participants = await t.admin.matchParticipant.findMany({
      where: { match: { categoryId: cat.categoryId } },
    });
    expect(participants.every((p) => !(p.isBye && p.entryId))).toBe(true);
    const advanced = await t.admin.auditLog.count({
      where: { action: 'bracket.advanced', competitionId: w.competitionId },
    });
    expect(advanced).toBeGreaterThan(0);

    const published = await t.admin.draw.findFirstOrThrow({
      where: { categoryId: cat.categoryId, status: 'PUBLISHED' },
    });
    const r = await send(
      w.staff.chief,
      'post',
      `/api/v1/draws/${published.id}/supersede`,
      { reason: 'Ошибка в посеве' },
      published.version,
    );
    expect(r.status).toBe(422);
    expect(r.body.error.details.failed).toEqual(['matches_started']);
  });
});

describe('results confirmed at the same time (Phase 7 hook)', () => {
  let brackets: BracketsService;
  let db: PrismaService;
  beforeAll(() => {
    brackets = t.app.get(BracketsService);
    db = t.app.get(PrismaService);
  });

  async function fourWay(): Promise<{ cat: CategoryFixture; semis: BracketNodeDto[] }> {
    const cat = await drawCategory(t, w, 4);
    await publish(
      w.staff.manager,
      await draft(w.staff.manager, cat.categoryId, { randomSeed: SEED_A, format: 'SINGLE_ELIMINATION' }),
    );
    const all = (await bracketOf(w.staff.manager, cat.categoryId)).bracket?.nodes as BracketNodeDto[];
    const semis = all.filter((n) => n.label === 'SEMIFINAL');
    expect(semis.map((n) => n.status)).toEqual(['READY', 'READY']);
    return { cat, semis };
  }

  it('advances both semifinal winners when the results are confirmed on two mats at once', async () => {
    for (let run = 0; run < 3; run++) {
      const { cat, semis } = await fourWay();
      await Promise.all(
        semis.map((n) => db.tx((tx) => brackets.applyConfirmedResult(tx, n.match?.id as string, 'BLUE'))),
      );
      const all = (await bracketOf(w.staff.manager, cat.categoryId)).bracket?.nodes as BracketNodeDto[];
      const final = all.find((n) => n.label === 'FINAL');
      expect(final?.status).toBe('READY');
      expect([final?.red.entryId, final?.blue.entryId].sort()).toEqual(
        semis.map((n) => n.blue.entryId).sort(),
      );
      const match = await t.admin.match.findUniqueOrThrow({
        where: { id: final?.match?.id as string },
        include: { participants: true },
      });
      expect(match.participants.every((p) => p.entryId !== null)).toBe(true);
    }
  });

  it('never loses a confirmed result to a new draw version made at the same moment', async () => {
    for (let run = 0; run < 3; run++) {
      const { cat, semis } = await fourWay();
      const published = await t.admin.draw.findFirstOrThrow({
        where: { categoryId: cat.categoryId, status: 'PUBLISHED' },
      });
      const [result, supersede] = await Promise.allSettled([
        db.tx((tx) => brackets.applyConfirmedResult(tx, semis[0]?.match?.id as string, 'RED')),
        send(
          w.staff.chief,
          'post',
          `/api/v1/draws/${published.id}/supersede`,
          { reason: 'Ошибка в посеве' },
          published.version,
        ),
      ]);
      const superseded = supersede.status === 'fulfilled' && supersede.value.status === 200;
      expect(result.status === 'fulfilled').toBe(!superseded);
      if (superseded) {
        expect(await t.admin.match.count({ where: { categoryId: cat.categoryId } })).toBe(0);
      } else {
        expect(supersede.status === 'fulfilled' && supersede.value.body.error.details.failed).toEqual([
          'matches_started',
        ]);
        const played = await t.admin.match.findUniqueOrThrow({
          where: { id: semis[0]?.match?.id as string },
        });
        expect(played).toMatchObject({ status: 'FINISHED', winnerSide: 'RED' });
      }
    }
  });
});
