// Рейтинговый турнир (фаза 8, docs/RATING_ARCHITECTURE.md, 3; docs/RATED_ONLY.md): все новые турниры рейтинговые,
// создаёт их только платформа. Прежний нерейтинговый турнир администратор переводит в рейтинговый до публикации,
// после публикации — административной процедурой с причиной; обратно в нерейтинговый — никогда, а после первого
// расчёта рейтинга тип не меняется и на уровне БД.
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RatingCalculationService, RatingRulesService } from '../src/modules/rating';
import {
  createOrg,
  createTestApp,
  createUser,
  login,
  resetData,
  type Session,
  type TestApp,
} from './helpers/app';
import { send } from './helpers/phase3';
import { ensureCompetition, isoDate, publishedRuleSet } from './helpers/phase4';
import { confirm, playToResult, refereeWorld, scheduledMatches } from './helpers/phase7';

let t: TestApp;
let orgId: string;
let organizer: Session;
let superAdmin: Session;
let platformAdmin: Session;

const day = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  orgId = await createOrg(t, { type: 'ORGANIZER' });
  const o = await createUser(t, { orgs: [{ organizationId: orgId, role: 'ORGANIZER' }] });
  organizer = await login(t, o.email);
  superAdmin = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
  platformAdmin = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, {
    totp: true,
  });
});
afterAll(async () => {
  await t.close();
});

const input = (over: Record<string, unknown> = {}) => {
  const start = new Date(Date.now() + 30 * day);
  return {
    name: 'Рейтинговый кубок клуба',
    organizerOrganizationId: orgId,
    level: 'CLUB',
    disciplineCode: 'SPORT_SAMBO',
    timezone: 'Europe/Moscow',
    startDate: isoDate(start),
    endDate: isoDate(start),
    registrationStartsAt: new Date(Date.now() - day).toISOString(),
    registrationEndsAt: new Date(Date.now() + 20 * day).toISOString(),
    ...over,
  };
};

interface CompetitionBody {
  id: string;
  version: number;
  competitionType: 'RATED' | 'NON_RATED';
  rating: { ruleSet: { calculationVersion: string }; publicDeltas: boolean } | null;
  allowedActions: string[];
}

/** Нерейтинговый черновик, созданный до перехода на рейтинговую систему (напрямую в БД: через API его не создать). */
async function legacyDraft(): Promise<CompetitionBody> {
  const id = await ensureCompetition(t, uuidv7(), { organizerId: orgId });
  const res = await organizer.agent.get(`/api/v1/competitions/${id}`).expect(200);
  return res.body.data as CompetitionBody;
}

const audits = (competitionId: string, action: string) =>
  t.admin.auditLog.findMany({ where: { competitionId, action }, orderBy: { occurredAt: 'asc' } });

describe('rated competition permissions', () => {
  it('an organizer creates no competition and cannot change the type of a prior one', async () => {
    const before = await t.admin.competition.count();
    for (const competitionType of [undefined, 'RATED', 'NON_RATED']) {
      const res = await send(organizer, 'post', '/api/v1/competitions', input({ competitionType }));
      expect(res.status).toBe(competitionType === 'NON_RATED' ? 400 : 403);
      if (res.status === 403) expect(res.body.error.code).toBe('RATED_COMPETITION_FORBIDDEN');
    }
    expect(await t.admin.competition.count()).toBe(before);

    const c = await legacyDraft();
    expect(c).toMatchObject({ competitionType: 'NON_RATED', rating: null });
    expect(c.allowedActions).not.toContain('competition.convert_to_rated');
    // Изменение турнира тип не принимает.
    const patched = await send(
      organizer,
      'patch',
      `/api/v1/competitions/${c.id}`,
      { name: 'Новое название турнира', competitionType: 'RATED' },
      c.version,
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.competitionType).toBe('NON_RATED');
    for (const path of ['rating', 'rating-type-change'])
      expect(
        (
          await send(organizer, 'post', `/api/v1/admin/competitions/${c.id}/${path}`, {
            competitionType: 'RATED',
            reason: 'Хочу рейтинг',
          })
        ).status,
      ).toBe(403);
    expect((await organizer.agent.get('/api/v1/admin/rating/rule-sets/active')).status).toBe(403);
  });

  it('a super admin creates a rated competition with the active rules pinned', async () => {
    const res = await send(superAdmin, 'post', '/api/v1/competitions', input({ competitionType: 'RATED' }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = res.body.data as CompetitionBody;
    expect(c).toMatchObject({
      competitionType: 'RATED',
      rating: { ruleSet: { calculationVersion: 'sambo-elo@1/elo-1' }, publicDeltas: true },
    });
    expect(c.allowedActions).toContain('competition.convert_to_rated');
    const [created] = await audits(c.id, 'competition.created');
    expect(created).toMatchObject({ platformIntervention: true });
    expect(created!.after).toMatchObject({ competitionType: 'RATED' });
  });

  it('a platform admin enables rating of a prior competition before publication, with a reason', async () => {
    const c = await legacyDraft();
    const noReason = await send(platformAdmin, 'post', `/api/v1/admin/competitions/${c.id}/rating`, {});
    expect(noReason.status).toBe(400);
    const res = await send(platformAdmin, 'post', `/api/v1/admin/competitions/${c.id}/rating`, {
      reason: 'Этап рейтинговой серии',
      publicDeltas: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ competitionType: 'RATED', rating: { publicDeltas: false } });
    const config = await t.admin.competitionRatingConfig.findUniqueOrThrow({
      where: { competitionId: c.id },
    });
    expect(config).toMatchObject({ reason: 'Этап рейтинговой серии', publicDeltas: false });
    const [audit] = await audits(c.id, 'competition.rating_enabled');
    expect(audit).toMatchObject({ platformIntervention: true, reason: 'Этап рейтинговой серии' });

    const again = await send(platformAdmin, 'post', `/api/v1/admin/competitions/${c.id}/rating`, {
      reason: 'Ещё раз включить',
    });
    expect(again.body.error.code).toBe('COMPETITION_TYPE_UNCHANGED');
    // Организатор видит рейтинговый тип, но управлять им не может.
    const seen = await organizer.agent.get(`/api/v1/competitions/${c.id}`).expect(200);
    expect(seen.body.data.competitionType).toBe('RATED');
    expect(seen.body.data.allowedActions).not.toContain('competition.convert_to_rated');

    const rules = await platformAdmin.agent.get('/api/v1/admin/rating/rule-sets/active').expect(200);
    expect(rules.body.data).toMatchObject({
      code: 'sambo-elo',
      calculationVersion: 'sambo-elo@1/elo-1',
      rules: { initialRating: 200 },
    });
  });

  it('after publication the type changes only by the administrative procedure, and never back', async () => {
    const c = await legacyDraft();
    await t.admin.competition.update({
      where: { id: c.id },
      data: {
        status: 'REGISTRATION_OPEN',
        publishedAt: new Date(),
        ruleSetVersionId: await publishedRuleSet(t),
      },
    });
    const locked = await send(platformAdmin, 'post', `/api/v1/admin/competitions/${c.id}/rating`, {
      reason: 'Поздно включаем',
    });
    expect(locked.body.error.code).toBe('COMPETITION_TYPE_LOCKED');
    // Обычное изменение строки — отказ базы данных.
    await expect(
      t.admin.competition.update({ where: { id: c.id }, data: { competitionType: 'RATED' } }),
    ).rejects.toThrow(/immutable after publication/);

    const toRated = await send(
      platformAdmin,
      'post',
      `/api/v1/admin/competitions/${c.id}/rating-type-change`,
      {
        competitionType: 'RATED',
        reason: 'Решение комиссии платформы',
      },
    );
    expect(toRated.status, JSON.stringify(toRated.body)).toBe(200);
    expect(toRated.body.data.competitionType).toBe('RATED');
    const back = await send(platformAdmin, 'post', `/api/v1/admin/competitions/${c.id}/rating-type-change`, {
      competitionType: 'NON_RATED',
      reason: 'Решение отменено комиссией',
    });
    expect(back.body.error.code).toBe('NON_RATED_COMPETITION_FORBIDDEN');
    expect(
      (await audits(c.id, 'competition.type_changed')).map((a) => [a.before, a.after, a.reason]),
    ).toEqual([
      [
        { competitionType: 'NON_RATED' },
        expect.objectContaining({ competitionType: 'RATED' }),
        'Решение комиссии платформы',
      ],
    ]);
  });

  it('once ratings are calculated the type cannot change at all', async () => {
    const w = await refereeWorld(t, [{ admitted: 2, format: 'SINGLE_ELIMINATION' }]);
    await t.admin.competition.update({ where: { id: w.competitionId }, data: { competitionType: 'RATED' } });
    await t.admin.competitionRatingConfig.create({
      data: { competitionId: w.competitionId, ruleSetId: (await t.app.get(RatingRulesService).active())!.id },
    });
    const [m] = (await scheduledMatches(t, w.categories[0]!.categoryId)).filter((x) =>
      x.participants.every((p) => p.entryId && !p.isBye),
    );
    const played = await playToResult(w.refs.chief1.s, m!.id, 'RED');
    expect((await confirm(w.refs.chief1.s, played)).status).toBe(200);
    expect(await t.app.get(RatingCalculationService).calculate(m!.id)).toMatchObject({ status: 'COMPLETED' });

    const res = await send(
      platformAdmin,
      'post',
      `/api/v1/admin/competitions/${w.competitionId}/rating-type-change`,
      { competitionType: 'NON_RATED', reason: 'Отменить рейтинг турнира' },
    );
    expect(res.body.error.code).toBe('NON_RATED_COMPETITION_FORBIDDEN');
    await expect(
      t.admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('sde.rating_type_change', 'on', true)`;
        await tx.competition.update({
          where: { id: w.competitionId },
          data: { competitionType: 'NON_RATED' },
        });
      }),
    ).rejects.toThrow(/rating calculations exist/);
  });
});
