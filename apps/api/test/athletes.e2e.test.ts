// Integration: спортсмены (API.md, 4.1; IMPLEMENTATION_PLAN, Phase 3): изоляция клубов, дубли,
// политика COACH_OWN, переход в другой клуб, разряды, архив, слияние.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOrg,
  createTestApp,
  createUser,
  login,
  resetData,
  type Session,
  type TestApp,
} from './helpers/app';
import { athleteInput, givePerson, send } from './helpers/phase3';

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

interface Club {
  fed: string;
  clubA: string;
  clubB: string;
  coachA: Session;
  coachA2: Session;
  managerA: Session;
  coachB: Session;
  federation: Session;
}

async function setup(): Promise<Club> {
  const fed = await createOrg(t, { type: 'REGIONAL_FEDERATION' });
  const clubA = await createOrg(t, { type: 'CLUB', parentId: fed });
  const clubB = await createOrg(t, { type: 'SPORTS_SCHOOL', parentId: fed });
  const mk = async (orgId: string, role: 'COACH' | 'CLUB_MANAGER' | 'FEDERATION_ADMIN', last: string) => {
    const u = await createUser(t, { orgs: [{ organizationId: orgId, role }] });
    await givePerson(t, u.id, { lastName: last, firstName: 'Тест', birthDate: '1985-01-01' });
    return login(t, u.email);
  };
  return {
    fed,
    clubA,
    clubB,
    coachA: await mk(clubA, 'COACH', 'Тренеров'),
    coachA2: await mk(clubA, 'COACH', 'Наставников'),
    managerA: await mk(clubA, 'CLUB_MANAGER', 'Директоров'),
    coachB: await mk(clubB, 'COACH', 'Чужаков'),
    federation: await mk(fed, 'FEDERATION_ADMIN', 'Федеральнов'),
  };
}

describe('create and isolation', () => {
  it('a coach creates an athlete, becomes the coach, sees the duplicate warning; another club sees nothing', async () => {
    const c = await setup();
    const created = await send(
      c.coachA,
      'post',
      '/api/v1/athletes',
      athleteInput(c.clubA, { rank: { sportRankCode: 'YOUTH_1', assignedAt: '2025-03-01' } }),
    );
    expect(created.status).toBe(201);
    const athlete = created.body.data;
    expect(athlete.publicId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{12}$/);
    expect(athlete.currentClub.id).toBe(c.clubA);
    expect(athlete.currentCoach.name).toContain('Тренеров');
    expect(athlete.currentRank.code).toBe('YOUTH_1');
    expect(athlete.consentsStatus).toEqual({
      PD_PROCESSING: 'MISSING',
      PD_DISTRIBUTION: 'MISSING',
      HEALTH_DATA: 'MISSING',
    });
    expect(athlete.allowedActions).toEqual(
      expect.arrayContaining(['athlete.update', 'guardian.manage', 'document.upload']),
    );
    expect(athlete.allowedActions).not.toContain('athlete.archive');

    // Тот же человек с опечаткой в фамилии — предупреждение о возможном дубле с публичными данными кандидата.
    const check = await send(c.coachA, 'post', '/api/v1/athletes/duplicates-check', {
      person: { lastName: 'Самбистов', firstName: 'Петр', birthDate: '2013-05-17', gender: 'MALE' },
    });
    expect(check.status).toBe(200);
    expect(check.body.data).toHaveLength(1);
    expect(check.body.data[0]).toMatchObject({
      athleteId: athlete.id,
      publicName: 'Самбистов П.',
      birthYear: 2013,
      similarity: 1,
    });
    const dup = await send(
      c.coachB,
      'post',
      '/api/v1/athletes',
      athleteInput(c.clubB, {
        person: { lastName: 'Самбистоф', firstName: 'Пётр', birthDate: '2013-05-17', gender: 'MALE' },
      }),
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('POSSIBLE_DUPLICATE');
    const candidate = dup.body.error.details.candidates[0];
    expect(Object.keys(candidate).sort()).toEqual([
      'athleteId',
      'birthYear',
      'clubShortName',
      'publicName',
      'regionName',
      'similarity',
    ]);
    const confirmed = await send(
      c.coachB,
      'post',
      '/api/v1/athletes',
      athleteInput(c.clubB, {
        person: { lastName: 'Самбистоф', firstName: 'Пётр', birthDate: '2013-05-17', gender: 'MALE' },
        confirmNotDuplicate: {
          candidateIds: [athlete.id],
          reason: 'Другой спортсмен, проверено по документам',
        },
      }),
    );
    expect(confirmed.status).toBe(201);
    const audit = await t.admin.auditLog.findFirst({
      where: { action: 'athlete.created', entityId: confirmed.body.data.id },
    });
    expect(audit?.reason).toContain('Другой спортсмен');
    expect(JSON.stringify(audit?.after)).not.toContain('Самбистоф');

    // Тренер другого клуба не видит спортсмена: 404 и нет в списке.
    expect((await c.coachB.agent.get(`/api/v1/athletes/${athlete.id}`)).status).toBe(404);
    const listB = await c.coachB.agent.get('/api/v1/athletes').expect(200);
    expect(listB.body.data.map((a: { id: string }) => a.id)).toEqual([confirmed.body.data.id]);
    expect(
      (await send(c.coachB, 'patch', `/api/v1/athletes/${athlete.id}`, { status: 'INACTIVE' }, 1)).status,
    ).toBe(404);
    expect((await c.coachB.agent.get('/api/v1/athletes').query({ organizationId: c.clubA })).status).toBe(
      404,
    );

    // Федерация видит спортсменов дочерних клубов, но не меняет их.
    const fedList = await c.federation.agent.get('/api/v1/athletes').expect(200);
    expect(fedList.body.data).toHaveLength(2);
    expect((await c.federation.agent.get(`/api/v1/athletes/${athlete.id}`)).status).toBe(200);
    expect(
      (await send(c.federation, 'patch', `/api/v1/athletes/${athlete.id}`, { status: 'INACTIVE' }, 1)).status,
    ).toBe(403);
  });

  it('COACH_OWN: another coach of the same club sees the athlete but cannot change it; the manager can', async () => {
    const c = await setup();
    const created = await send(c.coachA, 'post', '/api/v1/athletes', athleteInput(c.clubA));
    const id = created.body.data.id as string;
    const view = await c.coachA2.agent.get(`/api/v1/athletes/${id}`).expect(200);
    expect(view.body.data.allowedActions).not.toContain('athlete.update');
    expect(
      (await send(c.coachA2, 'patch', `/api/v1/athletes/${id}`, { person: { city: 'Энск' } }, 1)).status,
    ).toBe(403);
    const own = await send(c.coachA, 'patch', `/api/v1/athletes/${id}`, { person: { city: 'Энск' } }, 1);
    expect(own.status).toBe(200);
    expect(own.body.data.person.city).toBe('Энск');
    expect(own.headers.etag).toBe('"v2"');
    expect(
      (await send(c.coachA, 'patch', `/api/v1/athletes/${id}`, { person: { city: 'Икс' } }, 1)).body.error
        .code,
    ).toBe('VERSION_CONFLICT');
    expect(
      (await send(c.coachA, 'patch', `/api/v1/athletes/${id}`, { person: { city: 'Икс' } })).body.error.code,
    ).toBe('VERSION_REQUIRED');
    expect(
      (await send(c.managerA, 'patch', `/api/v1/athletes/${id}`, { status: 'INACTIVE' }, 2)).status,
    ).toBe(200);
    // Мои спортсмены: только свои у тренера.
    const mine = await c.coachA2.agent.get('/api/v1/athletes').query({ mine: 'true' }).expect(200);
    expect(mine.body.data).toEqual([]);
    const coach1 = await c.coachA.agent
      .get('/api/v1/athletes')
      .query({ mine: 'true', status: 'INACTIVE' })
      .expect(200);
    expect(coach1.body.data.map((a: { id: string }) => a.id)).toEqual([id]);
  });

  it('validates the age range, the club type and the organization status', async () => {
    const c = await setup();
    const old = await send(
      c.coachA,
      'post',
      '/api/v1/athletes',
      athleteInput(c.clubA, {
        person: { lastName: 'Старов', firstName: 'Иван', birthDate: '1990-01-01', gender: 'MALE' },
      }),
    );
    expect(old.body.error.code).toBe('VALIDATION_FAILED');
    expect(old.body.error.details.fields).toEqual([
      { path: 'person.birthDate', code: 'birth_date_out_of_range' },
    ]);
    const fedAthlete = await send(c.federation, 'post', '/api/v1/athletes', athleteInput(c.fed));
    expect(fedAthlete.body.error.details.fields).toEqual([{ path: 'organizationId', code: 'not_a_club' }]);
    const pending = await createOrg(t, { type: 'CLUB', status: 'PENDING_REVIEW' });
    const pm = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: pending, role: 'CLUB_MANAGER' }] })).email,
    );
    expect((await send(pm, 'post', '/api/v1/athletes', athleteInput(pending))).body.error.code).toBe(
      'ORGANIZATION_NOT_ACTIVE',
    );
    const noPerson = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: c.clubA, role: 'COACH' }] })).email,
    );
    const r = await send(
      noPerson,
      'post',
      '/api/v1/athletes',
      athleteInput(c.clubA, {
        person: { lastName: 'Новиков', firstName: 'Иван', birthDate: '2012-01-01', gender: 'MALE' },
      }),
    );
    expect(r.body.error.details.fields).toEqual([{ path: 'coachId', code: 'coach_profile_required' }]);
  });
});

describe('club, coach and rank history', () => {
  it('moves an athlete to another club: the previous primary membership closes the day before', async () => {
    const c = await setup();
    const both = await createUser(t, {
      orgs: [
        { organizationId: c.clubA, role: 'CLUB_MANAGER' },
        { organizationId: c.clubB, role: 'CLUB_MANAGER' },
      ],
    });
    const m = await login(t, both.email);
    const id = (await send(m, 'post', '/api/v1/athletes', athleteInput(c.clubA))).body.data.id as string;
    // Руководитель только одного клуба перевести не может.
    const onlyB = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: c.clubB, role: 'CLUB_MANAGER' }] })).email,
    );
    expect(
      (
        await send(onlyB, 'post', `/api/v1/athletes/${id}/memberships`, {
          organizationId: c.clubB,
          validFrom: '2030-01-10',
        })
      ).status,
    ).toBe(404);
    const moved = await send(m, 'post', `/api/v1/athletes/${id}/memberships`, {
      organizationId: c.clubB,
      validFrom: '2030-01-10',
      isPrimary: true,
    });
    expect(moved.status).toBe(201);
    const memberships = moved.body.data.memberships as {
      organization: { id: string };
      validTo: string | null;
      isPrimary: boolean;
    }[];
    expect(memberships.find((x) => x.organization.id === c.clubA)?.validTo).toBe('2030-01-09');
    expect(memberships.find((x) => x.organization.id === c.clubB)?.validTo).toBeNull();
    const early = await send(m, 'post', `/api/v1/athletes/${id}/memberships`, {
      organizationId: c.clubA,
      validFrom: '2020-01-01',
      isPrimary: true,
    });
    expect(early.body.error.code).toBe('VALIDATION_FAILED');
    const last = memberships.find((x) => x.organization.id === c.clubB) as unknown as { id: string };
    const endLast = await send(m, 'post', `/api/v1/athletes/${id}/memberships/${last.id}/end`, {
      validTo: '2031-01-01',
    });
    expect(endLast.body.error).toMatchObject({
      code: 'TRANSITION_PRECONDITIONS_NOT_MET',
      details: { failed: ['last_membership'] },
    });
  });

  it('links coaches of the club only, keeps rank history and archives with a reason', async () => {
    const c = await setup();
    const id = (await send(c.coachA, 'post', '/api/v1/athletes', athleteInput(c.clubA))).body.data
      .id as string;
    const coaches = await c.managerA.agent
      .get('/api/v1/coaches')
      .query({ organizationId: c.clubA })
      .expect(200);
    expect(coaches.body.data.map((x: { name: string }) => x.name)).toEqual([
      expect.stringContaining('Тренеров'),
    ]);
    // Тренер без аккаунта добавляется в клуб руководителем.
    const extra = await send(c.managerA, 'post', '/api/v1/coaches', {
      organizationId: c.clubA,
      person: { lastName: 'Бумажкин', firstName: 'Олег', birthDate: '1970-02-02', gender: 'MALE' },
    });
    expect(extra.status).toBe(201);
    const foreign = await send(c.managerA, 'post', '/api/v1/coaches', {
      organizationId: c.clubB,
      person: { lastName: 'Икс', firstName: 'Ик', birthDate: '1970-02-02', gender: 'MALE' },
    });
    expect(foreign.status).toBe(403);
    const linked = await send(c.managerA, 'post', `/api/v1/athletes/${id}/coaches`, {
      coachId: extra.body.data.id,
      validFrom: '2030-01-01',
      isPrimary: true,
    });
    expect(linked.status).toBe(201);
    expect(linked.body.data.coaches).toHaveLength(2);

    const r1 = await send(c.coachA, 'post', `/api/v1/athletes/${id}/ranks`, {
      sportRankCode: 'YOUTH_2',
      assignedAt: '2024-05-01',
      orderRef: '№ 12',
    });
    expect(r1.status).toBe(201);
    const r2 = await send(c.coachA, 'post', `/api/v1/athletes/${id}/ranks`, {
      sportRankCode: 'YOUTH_1',
      assignedAt: '2025-05-01',
    });
    expect(
      (
        await send(c.coachA, 'post', `/api/v1/athletes/${id}/ranks`, {
          sportRankCode: 'NOPE',
          assignedAt: '2025-05-01',
        })
      ).status,
    ).toBe(400);
    await send(c.coachA, 'post', `/api/v1/athletes/${id}/ranks/${r2.body.data.id}/revoke`, {
      reason: 'Ошибка в приказе',
    }).expect(200);
    const card = await c.coachA.agent.get(`/api/v1/athletes/${id}`).expect(200);
    expect(card.body.data.currentRank.code).toBe('YOUTH_2');
    const ranks = await c.coachA.agent.get(`/api/v1/athletes/${id}/ranks`).expect(200);
    expect(ranks.body.data).toHaveLength(2);

    expect(
      (await send(c.coachA, 'post', `/api/v1/athletes/${id}/archive`, { reason: 'Закончил занятия' })).status,
    ).toBe(403);
    const archived = await send(c.managerA, 'post', `/api/v1/athletes/${id}/archive`, {
      reason: 'Закончил занятия',
    });
    expect(archived.body.data.status).toBe('ARCHIVED');
    const list = await c.managerA.agent.get('/api/v1/athletes').expect(200);
    expect(list.body.data).toEqual([]);
    const archivedList = await c.managerA.agent
      .get('/api/v1/athletes')
      .query({ status: 'ARCHIVED' })
      .expect(200);
    expect(archivedList.body.data).toHaveLength(1);
  });
});

describe('merge duplicates', () => {
  it('the platform merges two records: history moves to the target, the source is archived', async () => {
    const c = await setup();
    const a = (await send(c.coachA, 'post', '/api/v1/athletes', athleteInput(c.clubA))).body.data
      .id as string;
    const b = (
      await send(
        c.coachB,
        'post',
        '/api/v1/athletes',
        athleteInput(c.clubB, {
          person: { lastName: 'Самбистов', firstName: 'Петя', birthDate: '2013-05-17', gender: 'MALE' },
          confirmNotDuplicate: { candidateIds: [a], reason: 'Проверю позже, похоже на дубль' },
          rank: { sportRankCode: 'SPORT_3', assignedAt: '2025-01-01' },
        }),
      )
    ).body.data.id as string;
    const adminUser = await createUser(t, { platform: ['SUPER_ADMIN'] });
    const admin = await login(t, adminUser.email, { totp: true });
    expect(
      (
        await send(c.managerA, 'post', '/api/v1/admin/athletes/merge', {
          sourceAthleteId: b,
          targetAthleteId: a,
          reason: 'Дубль',
        })
      ).status,
    ).toBe(403);
    const merged = await send(admin, 'post', '/api/v1/admin/athletes/merge', {
      sourceAthleteId: b,
      targetAthleteId: a,
      reason: 'Один и тот же спортсмен',
    });
    expect(merged.status).toBe(200);
    expect(merged.body.data.currentRank.code).toBe('SPORT_3');
    expect(
      merged.body.data.memberships.map((m: { organization: { id: string } }) => m.organization.id).sort(),
    ).toEqual([c.clubA, c.clubB].sort());
    const source = await t.admin.athleteProfile.findUniqueOrThrow({
      where: { id: b },
      include: { person: true },
    });
    expect(source.status).toBe('ARCHIVED');
    const target = await t.admin.athleteProfile.findUniqueOrThrow({ where: { id: a } });
    expect(source.person.mergedIntoId).toBe(target.personId);
    // Теперь спортсмен виден и во втором клубе.
    expect((await c.coachB.agent.get(`/api/v1/athletes/${a}`)).status).toBe(200);
    const again = await send(admin, 'post', '/api/v1/admin/athletes/merge', {
      sourceAthleteId: b,
      targetAthleteId: a,
      reason: 'Повтор слияния',
    });
    expect(again.body.error.code).toBe('TRANSITION_PRECONDITIONS_NOT_MET');
    const audit = await t.admin.auditLog.findFirst({ where: { action: 'athlete.merged' } });
    expect(audit).toMatchObject({ reason: 'Один и тот же спортсмен', platformIntervention: true });
  });
});
