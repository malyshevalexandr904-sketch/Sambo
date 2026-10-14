// Стенд нагрузочного теста Phase 8b (loadtest/README.md): турнир на 12 ковров с опубликованными сетками и
// расписанием, на каждом ковре — идущая схватка с запущенным секундомером и свой судья. Готовится через API (как
// refereeWorld интеграционных тестов) в отдельной базе (TEST_DATABASE_URL — например, sde_load); описание стенда
// для k6 — в LOAD_STAND_OUT (JSON: slug, ковры, схватки, адреса судей).
//
// Запуск: pnpm --filter api run load:stand (см. loadtest/README.md).
import { writeFileSync } from 'node:fs';
import {
  type DrawDto,
  type MatchDetailDto,
  type MatchEventResultDto,
  type MatDto,
  SAMPLE_RULESET_PARAMETERS,
  type ScheduleDto,
  type ScheduleSessionDto,
} from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, PASSWORD, resetData, type TestApp } from '../helpers/app';
import { send } from '../helpers/phase3';
import { isoDate } from '../helpers/phase4';
import { drawCategory, drawWorld, SEED_A } from '../helpers/phase5';
import { event, getMatch, official, transition } from '../helpers/phase7';

const MATS = Number(process.env.LOAD_MATS ?? 12);
const OUT = process.env.LOAD_STAND_OUT ?? 'loadtest-stand.json';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
});
afterAll(async () => {
  await t.close();
});

async function ruleSet(): Promise<string> {
  const ruleSetId = uuidv7();
  await t.admin.ruleSet.create({
    data: { id: ruleSetId, code: 'LOAD', disciplineCode: 'SPORT_SAMBO', name: 'Правила самбо (нагрузка)' },
  });
  const id = uuidv7();
  await t.admin.ruleSetVersion.create({
    data: {
      id,
      ruleSetId,
      version: 1,
      schemaVersion: 1,
      parameters: { ...SAMPLE_RULESET_PARAMETERS, matchDuration: [{ ageFrom: 10, ageTo: 17, seconds: 180 }] },
      checksum: 'd'.repeat(64),
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  return id;
}

it(
  'builds a 12-mat tournament with a running bout on every mat',
  async () => {
    const w = await drawWorld(t, { clubs: 6 });
    await t.admin.competition.update({
      where: { id: w.competitionId },
      data: { ruleSetVersionId: await ruleSet() },
    });
    const competition = await t.admin.competition.findUniqueOrThrow({ where: { id: w.competitionId } });
    const day = isoDate(competition.startDate);
    const mats: MatDto[] = [];
    for (let number = 1; number <= MATS; number++) {
      const r = await send(w.staff.manager, 'post', `/api/v1/competitions/${w.competitionId}/mats`, {
        number,
      });
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

    // Категория на ковёр: 4 участника — две схватки первого круга с известными парами.
    for (let i = 0; i < MATS; i++) {
      const cat = await drawCategory(t, w, 4, { code: `L-${String(i + 1).padStart(2, '0')}` });
      const draft = await send(w.staff.manager, 'post', `/api/v1/categories/${cat.categoryId}/draws`, {
        randomSeed: SEED_A,
        format: 'SINGLE_ELIMINATION',
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

    const out: { number: number; matId: string; matchId: string; seq: number; refereeEmail: string }[] = [];
    for (const mat of mats) {
      const judge = await official(t, w.competitionId);
      const crew = await send(
        w.staff.chief,
        'put',
        `/api/v1/competitions/${w.competitionId}/mat-assignments`,
        {
          sessionId: session.id,
          matId: mat.id,
          assignments: [{ role: 'REFEREE', userId: judge.id }],
        },
      );
      expect(crew.status, JSON.stringify(crew.body)).toBe(200);
      const first = await t.admin.match.findFirst({
        where: {
          schedule: { matId: mat.id },
          participants: { every: { entryId: { not: null } } },
          status: 'SCHEDULED',
        },
        include: { participants: true },
        orderBy: { schedule: { orderInMat: 'asc' } },
      });
      expect(first?.participants.filter((p) => p.entryId)).toHaveLength(2);
      let m: MatchDetailDto = await getMatch(judge.s, first!.id);
      for (const to of ['READY', 'IN_PROGRESS']) {
        const r = await transition(judge.s, m, to);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        m = r.body.data as MatchDetailDto;
      }
      const clock = await event(judge.s, m.id, {
        type: 'CLOCK_STARTED',
        matchClockMs: 0,
        expectedSeq: m.seq,
      });
      expect(clock.status, JSON.stringify(clock.body)).toBe(201);
      const email = (await t.admin.user.findUniqueOrThrow({ where: { id: judge.id } })).email as string;
      out.push({
        number: mat.number,
        matId: mat.id,
        matchId: m.id,
        seq: (clock.body.data as MatchEventResultDto).seq,
        refereeEmail: email,
      });
    }
    writeFileSync(
      OUT,
      `${JSON.stringify({ slug: competition.slug, competitionId: w.competitionId, password: PASSWORD, mats: out }, null, 2)}\n`,
    );
  },
  10 * 60_000,
);
