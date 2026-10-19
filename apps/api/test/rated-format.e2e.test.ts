// Формат рейтингового турнира (фаза 9, docs/RATED_TOURNAMENT_FORMAT.md): категория рейтингового турнира по умолчанию
// получает формат SPECIAL_GROUP_RATED и план подгрупп по числу допущенных; меньше 3 и больше 39 участников — ошибка
// формата; построение сетки подгрупп — следующие фазы. Нерейтинговый турнир выбирает формат по правилам, как раньше.
import type { CategoryDrawsDto } from '@sde/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';
import { type DrawWorld, drawCategory, drawWorld } from './helpers/phase5';

let t: TestApp;
let rated: DrawWorld;
let plain: DrawWorld;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  rated = await drawWorld(t);
  await t.admin.competition.update({
    where: { id: rated.competitionId },
    data: { competitionType: 'RATED' },
  });
  plain = await drawWorld(t);
});
afterAll(async () => {
  await t.close();
});

async function draws(w: DrawWorld, categoryId: string): Promise<CategoryDrawsDto> {
  const r = await w.staff.manager.agent.get(`/api/v1/categories/${categoryId}/draws`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as CategoryDrawsDto;
}

describe('rated tournament format', () => {
  it('suggests the group format with the plan for the admitted participants', async () => {
    const cat = await drawCategory(t, rated, 13);
    const d = await draws(rated, cat.categoryId);
    expect(d.suggestedFormat).toBe('SPECIAL_GROUP_RATED');
    expect(d.ratedPlan).toEqual({
      ok: true,
      plan: {
        formatVersion: 'rated-groups-v1',
        participants: 13,
        groups: [
          { letter: 'A', size: 3, matches: 3 },
          { letter: 'B', size: 3, matches: 3 },
          { letter: 'C', size: 3, matches: 3 },
          { letter: 'D', size: 4, matches: 6 },
        ],
        qualifiersPerGroup: 2,
        finalBracketSize: 8,
        finalPairing: [
          ['A1', 'B2'],
          ['C1', 'D2'],
          ['B1', 'A2'],
          ['D1', 'C2'],
        ],
        groupMatches: 15,
        finalMatches: 7,
        totalMatches: 22,
      },
    });
    // Сетку подгрупп строят следующие фазы: черновик пока не создаётся.
    const r = await send(rated.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(await t.admin.draw.count({ where: { categoryId: cat.categoryId } })).toBe(0);
  });

  it('rejects a draw with fewer participants than the format allows', async () => {
    const cat = await drawCategory(t, rated, 2);
    const d = await draws(rated, cat.categoryId);
    expect(d.ratedPlan).toEqual({
      ok: false,
      issue: 'INSUFFICIENT_PARTICIPANTS',
      minParticipants: 3,
      maxParticipants: 39,
    });
    const r = await send(rated.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {});
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'INSUFFICIENT_PARTICIPANTS',
      details: { admitted: 2, min: 3, max: 39 },
    });
  });

  it('rejects a draw with more participants than the format allows', async () => {
    const cat = await drawCategory(t, rated, 40);
    expect((await draws(rated, cat.categoryId)).ratedPlan).toMatchObject({
      ok: false,
      issue: 'TOO_MANY_PARTICIPANTS',
    });
    const r = await send(rated.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('TOO_MANY_PARTICIPANTS');
  });

  it('a category format override wins over the rated default', async () => {
    const cat = await drawCategory(t, rated, 4, { formatOverride: 'ROUND_ROBIN' });
    const d = await draws(rated, cat.categoryId);
    expect(d).toMatchObject({ suggestedFormat: 'ROUND_ROBIN', ratedPlan: null });
    const r = await send(rated.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it('a non-rated competition keeps the format chosen by its rules', async () => {
    const cat = await drawCategory(t, plain, 4);
    expect(await draws(plain, cat.categoryId)).toMatchObject({
      suggestedFormat: 'ROUND_ROBIN',
      ratedPlan: null,
    });
  });
});
