// Рейтинг спортсменов, фаза 2: версии правил расчёта (docs/RATING_ARCHITECTURE.md, 4).
import { canonicalJson } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { sha256Hex } from '@sde/server-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RatingRulesService, SAMBO_ELO_V1 } from '../src/modules/rating';
import { createTestApp, type TestApp } from './helpers/app';

let t: TestApp;
let rules: RatingRulesService;

beforeAll(async () => {
  t = await createTestApp();
  rules = t.app.get(RatingRulesService);
});
// Строки test-* остаются: действующую версию удалить нельзя, а схема пересоздаётся перед каждым прогоном.
afterAll(async () => {
  await t.close();
});

describe('rating rule sets', () => {
  it('ships sambo-elo@1 as the active version, equal to the domain rules', async () => {
    const active = await rules.active();
    expect(active).toMatchObject({
      code: 'sambo-elo',
      version: 1,
      status: 'ACTIVE',
      calculationVersion: 'sambo-elo@1/elo-1',
    });
    expect(active?.rules).toEqual(SAMBO_ELO_V1);
    const row = await t.admin.ratingRuleSet.findUniqueOrThrow({ where: { id: active?.id } });
    expect(row.checksum).toBe(sha256Hex(canonicalJson(SAMBO_ELO_V1)));
  });

  it('forbids changing or deleting an active version; only retiring it', async () => {
    const id = uuidv7();
    const base = {
      id,
      code: 'test-elo',
      version: 1,
      name: 'test',
      schemaVersion: 1,
      parameters: SAMBO_ELO_V1,
      checksum: 'x',
      engineVersion: 'elo-1',
    };
    await t.admin.ratingRuleSet.create({ data: base });
    // Черновик правится свободно.
    await t.admin.ratingRuleSet.update({ where: { id }, data: { name: 'draft edit' } });
    await t.admin.ratingRuleSet.update({ where: { id }, data: { status: 'ACTIVE', activeFrom: new Date() } });
    await expect(
      t.admin.ratingRuleSet.update({
        where: { id },
        data: { parameters: { ...SAMBO_ELO_V1, initialRating: 300 } },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(t.admin.ratingRuleSet.delete({ where: { id } })).rejects.toThrow(/immutable/);
    // Вторая действующая версия того же кода невозможна.
    await expect(
      t.admin.ratingRuleSet.create({
        data: { ...base, id: uuidv7(), version: 2, status: 'ACTIVE', activeFrom: new Date() },
      }),
    ).rejects.toThrow();
    await t.admin.ratingRuleSet.update({ where: { id }, data: { status: 'RETIRED', activeTo: new Date() } });
    await expect(t.admin.ratingRuleSet.update({ where: { id }, data: { status: 'ACTIVE' } })).rejects.toThrow(
      /immutable/,
    );
    expect((await rules.byId(id))?.status).toBe('RETIRED');
  });

  it('refuses to read a version with parameters the schema does not accept', async () => {
    const id = uuidv7();
    await t.admin.ratingRuleSet.create({
      data: {
        id,
        code: 'test-broken',
        version: 1,
        name: 'broken',
        schemaVersion: 1,
        parameters: { ...SAMBO_ELO_V1, scoreRules: { ...SAMBO_ELO_V1.scoreRules, CLEAN_WIN: '0.95' } },
        checksum: 'x',
        engineVersion: 'elo-1',
      },
    });
    await expect(rules.byId(id)).rejects.toThrow(/invalid parameters/);
  });
});
