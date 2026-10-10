// Публикация жеребьёвок для учебного турнира «Открытый ковёр» (seed Phase 6: packages/db/seed/phase6.ts;
// план Phase 6, §10) и подготовка турнира «Кубок ковра» к судейству (seed Phase 7a: packages/db/seed/phase7.ts;
// план Phase 7a, §8): жеребьёвки, расписание, публикация, «Расписание готово», бригады ковров; для итогов
// (Phase 7b) главный судья проводит все схватки категории «Девушки свыше 44 кг» — она завершена, места посчитаны,
// результаты ждут публикации. Запускается один раз после "pnpm db:seed": сам seed пишет фикстуры прямо в БД, а сетку и
// схватки категории создаёт только реальный код API (BracketsService/DrawsService) — так демонстрационные
// данные проходят ту же бизнес-логику, что и настоящая жеребьёвка, вместо повторной реализации её в seed.
// Расписание не строится — секретарь строит его на экране при демонстрации.
//
// Запуск: pnpm --filter api run seed:schedule (эквивалент "node --env-file-if-exists=../../.env
// -r @swc-node/register scripts/seed-schedule.ts" из apps/api — так же, как запускается dev-сервер).
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Competition, DrawDto, MatchDetailDto, MatchEventResultDto, ScheduleDto } from '@sde/contracts';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/** SEED_IDS.competitionSchedule (packages/db/seed/data.ts) — турнир «Открытый ковёр» с уже готовыми к
 *  жеребьёвке категориями. Захардкожен, а не импортирован: packages/db/seed — скрипт разработки, а не часть
 *  опубликованного пакета @sde/db. */
const COMPETITION_ID = '01920000-0000-7000-8015-000000000004';
/** SEED_IDS.competitionReferee — турнир «Кубок ковра» (seed Phase 7a), его ковры и сессия (P7 в phase7.ts). */
const REFEREE_COMPETITION_ID = '01920000-0000-7000-8015-000000000005';
const REFEREE_MATS = ['01920000-0000-7000-8040-000000000001', '01920000-0000-7000-8040-000000000002'];
const REFEREE_SESSION = '01920000-0000-7000-8041-000000000001';
const ORGANIZER_EMAIL = 'organizer@sambo.local';
/** P7.category(3) — «Девушки 12–15 лет, свыше 44 кг» (круговая, 5 участниц): её проводит seed для итогов Phase 7b. */
const RESULTS_CATEGORY = '01920000-0000-7000-8036-000000000003';
const CHIEF_REFEREE_EMAIL = 'referee1@sambo.local';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`seed-schedule: environment variable ${name} is required`);
  return value;
}

async function login(agent: TestAgent, email: string, password: string): Promise<string> {
  const csrfRes = await agent.get('/api/v1/auth/csrf').expect(200);
  const csrf = (csrfRes.body as { data: { csrfToken: string } }).data.csrfToken;
  const res = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('sde_csrf='));
  return cookie ? decodeURIComponent(cookie.split(';')[0]!.slice('sde_csrf='.length)) : csrf;
}

type Agent = TestAgent;
type Db = PrismaService;

async function expectStatus(
  res: { status: number; body: unknown },
  status: number,
  what: string,
): Promise<{ data: unknown }> {
  if (res.status !== status) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { data: unknown };
}

/** Черновик и публикация жеребьёвки каждой категории турнира, готовой к жеребьёвке. */
async function publishDraws(agent: Agent, csrf: string, db: Db, competitionId: string): Promise<string[]> {
  const categories = await db.competitionCategory.findMany({
    where: { competitionId, status: 'READY_FOR_DRAW' },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, nameRu: true },
  });
  const published: string[] = [];
  for (const category of categories) {
    const draft = await expectStatus(
      await agent.post(`/api/v1/categories/${category.id}/draws`).set('x-csrf-token', csrf).send({}),
      201,
      `draft ${category.nameRu}`,
    );
    const d = draft.data as DrawDto;
    const publish = await expectStatus(
      await agent
        .post(`/api/v1/draws/${d.id}/publish`)
        .set('x-csrf-token', csrf)
        .set('if-match', `"v${d.version}"`)
        .send({}),
      200,
      `publish ${category.nameRu}`,
    );
    const p = publish.data as DrawDto;
    published.push(`  ${category.nameRu} — draw #${p.number}, status ${p.status}`);
  }
  return published;
}

/** Бригады ковров «Кубка ковра» в сессии дня: ковёр 1 — планшет и руководитель отдельно, ковёр 2 — один судья. */
async function assignCrews(agent: Agent, csrf: string, db: Db): Promise<void> {
  const user = async (email: string): Promise<string> =>
    (await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const crews: [string, { role: string; userId: string }[]][] = [
    [
      REFEREE_MATS[0] as string,
      [
        { role: 'MAT_CHIEF', userId: await user('referee3@sambo.local') },
        { role: 'REFEREE', userId: await user('referee2@sambo.local') },
        { role: 'TECHNICAL_SECRETARY', userId: await user('secretary@sambo.local') },
      ],
    ],
    [REFEREE_MATS[1] as string, [{ role: 'MAT_CHIEF', userId: await user('referee4@sambo.local') }]],
  ];
  for (const [matId, assignments] of crews)
    await expectStatus(
      await agent
        .put(`/api/v1/competitions/${REFEREE_COMPETITION_ID}/mat-assignments`)
        .set('x-csrf-token', csrf)
        .send({ sessionId: REFEREE_SESSION, matId, assignments }),
      200,
      'mat crew',
    );
}

/**
 * «Кубок ковра»: жеребьёвки, расписание (генерация и публикация), переход «Расписание готово», бригады ковров —
 * тем же API, что и на экранах. Уже сделанные шаги пропускаются.
 */
async function prepareRefereeing(agent: Agent, csrf: string, db: Db): Promise<string> {
  const id = REFEREE_COMPETITION_ID;
  const exists = await db.competition.findUnique({ where: { id }, select: { status: true } });
  if (!exists) return 'seed-schedule: «Кубок ковра» — seed Phase 7a not run yet.';
  const draws = await publishDraws(agent, csrf, db, id);
  let schedule = (await expectStatus(await agent.get(`/api/v1/competitions/${id}/schedule`), 200, 'schedule'))
    .data as ScheduleDto;
  if (schedule.status === 'DRAFT') {
    if (schedule.items.length === 0)
      schedule = (
        await expectStatus(
          await agent
            .post(`/api/v1/competitions/${id}/schedule/generate`)
            .set('x-csrf-token', csrf)
            .send({ finalsBlock: true }),
          201,
          'generate schedule',
        )
      ).data as ScheduleDto;
    await expectStatus(
      await agent
        .post(`/api/v1/competitions/${id}/schedule/publish`)
        .set('x-csrf-token', csrf)
        .set('if-match', `"v${schedule.version}"`)
        .send({}),
      200,
      'publish schedule',
    );
  }
  const competition = (await expectStatus(await agent.get(`/api/v1/competitions/${id}`), 200, 'competition'))
    .data as Competition;
  if (competition.status === 'DRAWING')
    await expectStatus(
      await agent
        .post(`/api/v1/competitions/${id}/transitions`)
        .set('x-csrf-token', csrf)
        .set('if-match', `"v${competition.version}"`)
        .send({ to: 'SCHEDULED' }),
      200,
      'transition to SCHEDULED',
    );
  await assignCrews(agent, csrf, db);
  return [
    `seed-schedule: «Кубок ковра» — ${draws.length} draw(s) published now, schedule published, mat crews assigned.`,
    '  Open «Судейство» as referee2@sambo.local (tablet of mat 1) and referee3@sambo.local (confirmations).',
  ].join('\n');
}

/** События схватки по порядку — с ключом идемпотентности и ожидаемым номером журнала, как у планшета. */
async function sendEvents(
  agent: Agent,
  csrf: string,
  matchId: string,
  fromSeq: number,
  steps: { type: string; matchClockMs: number; side?: string; actionCode?: string }[],
  duration: number,
): Promise<number> {
  let seq = fromSeq;
  const start = Date.now() - duration;
  for (const step of steps) {
    const res = await agent
      .post(`/api/v1/matches/${matchId}/events`)
      .set('x-csrf-token', csrf)
      .set('idempotency-key', randomUUID())
      .send({ ...step, expectedSeq: seq, deviceTime: new Date(start + step.matchClockMs).toISOString() });
    seq = ((await expectStatus(res, 201, `event ${step.type}`)).data as MatchEventResultDto).seq;
  }
  return seq;
}

/** Провести схватку на планшете тем же API: вызов, старт, время, бросок победителя, «время вышло», результат. */
async function playMatch(agent: Agent, csrf: string, matchId: string, winner: 'RED' | 'BLUE'): Promise<void> {
  const get = async (): Promise<MatchDetailDto> =>
    (await expectStatus(await agent.get(`/api/v1/matches/${matchId}`), 200, 'match')).data as MatchDetailDto;
  const go = async (m: MatchDetailDto, to: string): Promise<MatchDetailDto> =>
    (
      await expectStatus(
        await agent
          .post(`/api/v1/matches/${matchId}/transitions`)
          .set('x-csrf-token', csrf)
          .set('if-match', `"v${m.version}"`)
          .send({ to }),
        200,
        `match → ${to}`,
      )
    ).data as MatchDetailDto;
  let m = await get();
  if (m.status === 'SCHEDULED') m = await go(m, 'READY');
  if (m.status === 'READY') m = await go(m, 'IN_PROGRESS');
  const duration = (m.durationSeconds ?? 180) * 1000;
  const throwAt = 20_000 + ((m.number ?? 0) % 10) * 5_000;
  const steps = [
    { type: 'CLOCK_STARTED', matchClockMs: 0 },
    { type: 'SCORE', side: winner, actionCode: 'THROW_2', matchClockMs: throwAt },
    {
      type: 'SCORE',
      side: winner === 'RED' ? 'BLUE' : 'RED',
      actionCode: 'THROW_1',
      matchClockMs: throwAt + 35_000,
    },
    { type: 'CLOCK_STOPPED', matchClockMs: duration },
  ];
  const seq = await sendEvents(agent, csrf, matchId, m.seq, steps, duration);
  m = await get();
  m = (
    await expectStatus(
      await agent
        .post(`/api/v1/matches/${matchId}/result`)
        .set('x-csrf-token', csrf)
        .set('if-match', `"v${m.version}"`)
        .send({ expectedSeq: seq, winnerSide: winner, method: 'POINTS' }),
      200,
      'result',
    )
  ).data as MatchDetailDto;
  await expectStatus(
    await agent
      .post(`/api/v1/matches/${matchId}/result/confirm`)
      .set('x-csrf-token', csrf)
      .set('if-match', `"v${m.version}"`)
      .send({}),
    200,
    'confirm',
  );
}

/**
 * Итоги (Phase 7b): главный судья проводит все схватки категории «Девушки свыше 44 кг» — после последнего
 * подтверждения категория завершается автоматически, места и медали посчитаны; публикацию показывают вручную.
 * Победитель пары — участница с меньшим номером участия (места 1–5 без равенств). Уже проведённое пропускается.
 */
async function playResultsCategory(agent: Agent, csrf: string, db: Db): Promise<string> {
  const category = await db.competitionCategory.findUnique({
    where: { id: RESULTS_CATEGORY },
    select: { status: true, nameRu: true },
  });
  if (!category) return 'seed-schedule: results category not found (seed Phase 7a not run yet).';
  if (category.status !== 'DRAWN' && category.status !== 'IN_PROGRESS')
    return `seed-schedule: «${category.nameRu}» — ${category.status}, nothing to play.`;
  const matches = await db.match.findMany({
    where: { categoryId: RESULTS_CATEGORY, status: { notIn: ['FINISHED', 'CANCELLED'] } },
    include: { participants: true },
    orderBy: { matchNumber: 'asc' },
  });
  let played = 0;
  for (const match of matches) {
    const red = match.participants.find((p) => p.side === 'RED')?.entryId;
    const blue = match.participants.find((p) => p.side === 'BLUE')?.entryId;
    if (!red || !blue) continue;
    await playMatch(agent, csrf, match.id, red < blue ? 'RED' : 'BLUE');
    played += 1;
  }
  const after = await db.competitionCategory.findUniqueOrThrow({
    where: { id: RESULTS_CATEGORY },
    select: { status: true },
  });
  return [
    `seed-schedule: «${category.nameRu}» — ${played} match(es) played and confirmed, category ${after.status}.`,
    '  «Итоги» tab of «Кубок ковра»: publish the results as referee1@sambo.local (chief referee).',
  ].join('\n');
}

async function main(): Promise<void> {
  const password = required('SEED_PASSWORD');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { useLogger: false });
  await app.init();
  const db = app.get(PrismaService);

  try {
    const agent = request.agent(app.getHttpServer());
    const csrf = await login(agent, ORGANIZER_EMAIL, password);
    const published = await publishDraws(agent, csrf, db, COMPETITION_ID);
    process.stdout.write(
      published.length
        ? `seed-schedule: published ${published.length} draw(s):\n${published.join('\n')}\n`
        : 'seed-schedule: «Открытый ковёр» — no categories at READY_FOR_DRAW (already published or seed not run).\n',
    );
    process.stdout.write(`${await prepareRefereeing(agent, csrf, db)}\n`);
    const chief = request.agent(app.getHttpServer());
    const chiefCsrf = await login(chief, CHIEF_REFEREE_EMAIL, password);
    process.stdout.write(`${await playResultsCategory(chief, chiefCsrf, db)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
