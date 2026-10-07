// Публикация жеребьёвок для учебного турнира «Открытый ковёр» (seed Phase 6: packages/db/seed/phase6.ts;
// план Phase 6, §10) и подготовка турнира «Кубок ковра» к судейству (seed Phase 7a: packages/db/seed/phase7.ts;
// план Phase 7a, §8): жеребьёвки, расписание, публикация, «Расписание готово», бригады ковров. Запускается один раз после "pnpm db:seed": сам seed пишет фикстуры прямо в БД, а сетку и
// схватки категории создаёт только реальный код API (BracketsService/DrawsService) — так демонстрационные
// данные проходят ту же бизнес-логику, что и настоящая жеребьёвка, вместо повторной реализации её в seed.
// Расписание не строится — секретарь строит его на экране при демонстрации.
//
// Запуск: pnpm --filter api run seed:schedule (эквивалент "node --env-file-if-exists=../../.env
// -r @swc-node/register scripts/seed-schedule.ts" из apps/api — так же, как запускается dev-сервер).
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Competition, DrawDto, ScheduleDto } from '@sde/contracts';
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
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
