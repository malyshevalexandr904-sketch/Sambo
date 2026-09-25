// Integration: правила и категории (API.md, 4.5; ADR-09): версии правил, неизменяемость опубликованной,
// возрастные группы, весовые категории, шаблоны; права по владельцу (платформа или организация).
import { SAMPLE_RULESET_PARAMETERS } from '@sde/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOrg, createTestApp, createUser, login, resetData, type TestApp } from './helpers/app';
import { send } from './helpers/phase3';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetData(t);
});

describe('rule sets', () => {
  it('drafts are editable, published versions are frozen with a checksum', async () => {
    const admin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, {
      totp: true,
    });
    const rs = await send(admin, 'post', '/api/v1/rulesets', {
      code: 'SAMBO_YOUTH',
      disciplineCode: 'SPORT_SAMBO',
      name: 'Самбо, юноши',
    });
    expect(rs.status).toBe(201);
    expect(rs.body.data.owner).toBeNull();
    expect(
      (
        await send(admin, 'post', '/api/v1/rulesets', {
          code: 'SAMBO_YOUTH',
          disciplineCode: 'SPORT_SAMBO',
          name: 'Название',
        })
      ).body.error.code,
    ).toBe('ALREADY_EXISTS');
    const id = rs.body.data.id as string;

    const invalid = await send(admin, 'post', `/api/v1/rulesets/${id}/versions`, {
      parameters: { ...SAMPLE_RULESET_PARAMETERS, superiorityPoints: 0, extra: true },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('RULESET_PARAMETERS_INVALID');
    expect(invalid.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(['parameters.superiorityPoints']),
    );
    const v1 = await send(admin, 'post', `/api/v1/rulesets/${id}/versions`, {
      parameters: SAMPLE_RULESET_PARAMETERS,
    });
    expect(v1.body.data).toMatchObject({ version: 1, status: 'DRAFT', checksum: null, schemaVersion: 1 });
    const edited = await send(admin, 'patch', `/api/v1/rulesets/${id}/versions/1`, {
      parameters: { ...SAMPLE_RULESET_PARAMETERS, minRestSeconds: 900 },
    });
    expect(edited.body.data.parameters.minRestSeconds).toBe(900);
    const published = await send(admin, 'post', `/api/v1/rulesets/${id}/versions/1/publish`);
    expect(published.body.data).toMatchObject({ status: 'PUBLISHED' });
    expect(published.body.data.checksum).toMatch(/^[a-f0-9]{64}$/);
    const frozen = await send(admin, 'patch', `/api/v1/rulesets/${id}/versions/1`, {
      parameters: SAMPLE_RULESET_PARAMETERS,
    });
    expect(frozen.body.error.code).toBe('RULESET_VERSION_IMMUTABLE');
    expect((await send(admin, 'post', `/api/v1/rulesets/${id}/versions/1/publish`)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
    await expect(
      t.admin.ruleSetVersion.update({
        where: { id: v1.body.data.id },
        data: { parameters: { hacked: true } },
      }),
    ).rejects.toThrow(/immutable/);
    const v2 = await send(admin, 'post', `/api/v1/rulesets/${id}/versions`, { basedOnVersion: 1 });
    expect(v2.body.data).toMatchObject({ version: 2, status: 'DRAFT' });
    expect(v2.body.data.parameters.minRestSeconds).toBe(900);
    const detail = await admin.agent.get(`/api/v1/rulesets/${id}`).expect(200);
    expect(detail.body.data).toMatchObject({ latestPublishedVersion: 1, allowedActions: ['ruleset.manage'] });
    expect(detail.body.data.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('an organizer manages rule sets of the organization; a coach only reads', async () => {
    const org = await createOrg(t, { type: 'ORGANIZER' });
    const club = await createOrg(t, { type: 'CLUB' });
    const organizer = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: org, role: 'ORGANIZER' }] })).email,
    );
    const coach = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: club, role: 'COACH' }] })).email,
    );
    const own = await send(organizer, 'post', '/api/v1/rulesets', {
      code: 'CUP_RULES',
      disciplineCode: 'SPORT_SAMBO',
      name: 'Кубок',
      ownerOrganizationId: org,
    });
    expect(own.status).toBe(201);
    expect(
      (
        await send(organizer, 'post', '/api/v1/rulesets', {
          code: 'PLATFORM_X',
          disciplineCode: 'SPORT_SAMBO',
          name: 'Название',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(coach, 'post', '/api/v1/rulesets', {
          code: 'COACH_X',
          disciplineCode: 'SPORT_SAMBO',
          name: 'Название',
          ownerOrganizationId: club,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(coach, 'post', `/api/v1/rulesets/${own.body.data.id}/versions`, {
          parameters: SAMPLE_RULESET_PARAMETERS,
        })
      ).status,
    ).toBe(403);
    const list = await coach.agent.get('/api/v1/rulesets').expect(200);
    expect(
      list.body.data.map((r: { code: string; allowedActions: string[] }) => [r.code, r.allowedActions]),
    ).toEqual([['CUP_RULES', []]]);
  });
});

describe('age groups, weight categories, templates', () => {
  it('builds a template from groups and weights of the owner lineage and protects used records', async () => {
    const fed = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
    const org = await createOrg(t, { type: 'ORGANIZER', parentId: fed });
    const fa = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: fed, role: 'FEDERATION_ADMIN' }] })).email,
    );
    const organizer = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: org, role: 'ORGANIZER' }] })).email,
    );

    const group = await send(fa, 'post', '/api/v1/age-groups', {
      disciplineCode: 'SPORT_SAMBO',
      code: 'Y12_13',
      name: { ru: 'Юноши 12–13 лет', en: 'Boys 12–13' },
      ageFrom: 12,
      ageTo: 13,
      ownerOrganizationId: fed,
    });
    expect(group.body.data).toMatchObject({ policy: 'BY_BIRTH_YEAR', allowedActions: ['category.manage'] });
    const bad = await send(fa, 'post', '/api/v1/age-groups', {
      disciplineCode: 'SPORT_SAMBO',
      code: 'BAD',
      name: { ru: 'x', en: 'x' },
      ageFrom: 14,
      ageTo: 12,
      ownerOrganizationId: fed,
    });
    expect(bad.body.error.details.fields).toEqual([{ path: 'ageTo', code: 'age_range_invalid' }]);
    const dup = await send(fa, 'post', '/api/v1/age-groups', {
      disciplineCode: 'SPORT_SAMBO',
      code: 'Y12_13',
      name: { ru: 'x', en: 'x' },
      ageFrom: 12,
      ageTo: 13,
      ownerOrganizationId: fed,
    });
    expect(dup.body.error.code).toBe('ALREADY_EXISTS');
    const groupId = group.body.data.id as string;

    const w = async (gender: string, kind: string, limitGrams: number) =>
      (await send(fa, 'post', '/api/v1/weight-categories', { ageGroupId: groupId, gender, kind, limitGrams }))
        .body.data.id as string;
    const m35 = await w('MALE', 'UP_TO', 35_000);
    const m38 = await w('MALE', 'UP_TO', 38_000);
    const m38p = await w('MALE', 'ABOVE', 38_000);
    const f35 = await w('FEMALE', 'UP_TO', 35_000);
    expect(
      (
        await send(fa, 'post', '/api/v1/weight-categories', {
          ageGroupId: groupId,
          gender: 'MALE',
          kind: 'UP_TO',
          limitGrams: 38_000,
        })
      ).body.error.code,
    ).toBe('ALREADY_EXISTS');
    expect(
      (
        await send(organizer, 'post', '/api/v1/weight-categories', {
          ageGroupId: groupId,
          gender: 'MALE',
          kind: 'UP_TO',
          limitGrams: 42_000,
        })
      ).status,
    ).toBe(403);

    // Организатор дочерней организации строит свой шаблон из групп федерации.
    const mixed = await send(organizer, 'post', '/api/v1/category-templates', {
      name: 'Кубок: юноши и девушки',
      disciplineCode: 'SPORT_SAMBO',
      ownerOrganizationId: org,
      items: [{ ageGroupId: groupId, gender: 'MALE', weightCategoryIds: [m35, f35] }],
    });
    expect(mixed.body.error.details.fields).toEqual([
      { path: 'items.0.weightCategoryIds', code: 'invalid_weight_category' },
    ]);
    const tpl = await send(organizer, 'post', '/api/v1/category-templates', {
      name: 'Кубок: юноши и девушки',
      disciplineCode: 'SPORT_SAMBO',
      ownerOrganizationId: org,
      items: [
        { ageGroupId: groupId, gender: 'MALE', weightCategoryIds: [m35, m38, m38p] },
        { ageGroupId: groupId, gender: 'FEMALE', weightCategoryIds: [f35] },
      ],
    });
    expect(tpl.status).toBe(201);
    expect(tpl.body.data).toMatchObject({ categoryCount: 4, allowedActions: ['category.manage'] });
    expect(tpl.body.data.items.map((i: { gender: string }) => i.gender)).toEqual(['MALE', 'FEMALE']);

    // Группа и вес, используемые в шаблоне, не удаляются.
    expect((await send(fa, 'delete', `/api/v1/weight-categories/${m38}`)).body.error.code).toBe(
      'TRANSITION_PRECONDITIONS_NOT_MET',
    );
    expect((await send(fa, 'delete', `/api/v1/age-groups/${groupId}`)).body.error.code).toBe(
      'TRANSITION_PRECONDITIONS_NOT_MET',
    );
    const patched = await send(organizer, 'patch', `/api/v1/category-templates/${tpl.body.data.id}`, {
      items: [{ ageGroupId: groupId, gender: 'MALE', weightCategoryIds: [m35] }],
    });
    expect(patched.body.data.categoryCount).toBe(1);
    await send(fa, 'delete', `/api/v1/weight-categories/${m38}`).expect(204);
    await send(organizer, 'delete', `/api/v1/category-templates/${tpl.body.data.id}`).expect(204);
    await send(fa, 'delete', `/api/v1/age-groups/${groupId}`).expect(204);
    const groups = await organizer.agent.get('/api/v1/age-groups').query({ owner: fed }).expect(200);
    expect(groups.body.data).toEqual([]);
  });
});
