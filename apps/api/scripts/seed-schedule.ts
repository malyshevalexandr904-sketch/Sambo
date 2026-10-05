// Публикация жеребьёвок для учебного турнира «Открытый ковёр» (seed Phase 6: packages/db/seed/phase6.ts;
// план Phase 6, §10). Запускается один раз после "pnpm db:seed": сам seed пишет фикстуры прямо в БД, а сетку и
// схватки категории создаёт только реальный код API (BracketsService/DrawsService) — так демонстрационные
// данные проходят ту же бизнес-логику, что и настоящая жеребьёвка, вместо повторной реализации её в seed.
// Расписание не строится — секретарь строит его на экране при демонстрации.
//
// Запуск: pnpm --filter api run seed:schedule (эквивалент "node --env-file-if-exists=../../.env
// -r @swc-node/register scripts/seed-schedule.ts" из apps/api — так же, как запускается dev-сервер).
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { DrawDto } from '@sde/contracts';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/** SEED_IDS.competitionSchedule (packages/db/seed/data.ts) — турнир «Открытый ковёр» с уже готовыми к
 *  жеребьёвке категориями. Захардкожен, а не импортирован: packages/db/seed — скрипт разработки, а не часть
 *  опубликованного пакета @sde/db. */
const COMPETITION_ID = '01920000-0000-7000-8015-000000000004';
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

async function main(): Promise<void> {
  const password = required('SEED_PASSWORD');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { useLogger: false });
  await app.init();
  const db = app.get(PrismaService);

  try {
    const categories = await db.competitionCategory.findMany({
      where: { competitionId: COMPETITION_ID, status: 'READY_FOR_DRAW' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameRu: true },
    });
    if (categories.length === 0) {
      process.stdout.write(
        'seed-schedule: no categories at READY_FOR_DRAW — already published, or seed Phase 6 not run yet.\n',
      );
      return;
    }

    const agent = request.agent(app.getHttpServer());
    const csrf = await login(agent, ORGANIZER_EMAIL, password);

    const published: string[] = [];
    for (const category of categories) {
      const draft = await agent
        .post(`/api/v1/categories/${category.id}/draws`)
        .set('x-csrf-token', csrf)
        .send({});
      if (draft.status !== 201)
        throw new Error(`draft ${category.nameRu}: ${draft.status} ${JSON.stringify(draft.body)}`);
      const d = (draft.body as { data: DrawDto }).data;
      const publish = await agent
        .post(`/api/v1/draws/${d.id}/publish`)
        .set('x-csrf-token', csrf)
        .set('if-match', `"v${d.version}"`)
        .send({});
      if (publish.status !== 200)
        throw new Error(`publish ${category.nameRu}: ${publish.status} ${JSON.stringify(publish.body)}`);
      const p = (publish.body as { data: DrawDto }).data;
      published.push(`  ${category.nameRu} — draw #${p.number}, status ${p.status}`);
    }
    process.stdout.write(`seed-schedule: published ${published.length} draw(s):\n${published.join('\n')}\n`);
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
