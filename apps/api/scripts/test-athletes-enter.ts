// Заявка тестовых спортсменов на пробный турнир (deploy/server/test-athletes.sh enter): все спортсмены «Тестового
// клуба» (packages/db/scripts/test-athletes.ts) заявляются с плановым весом в подходящую по весу категорию, заявка
// подаётся; если у пользователя есть права секретаря турнира — участники и заявка сразу одобряются. Всё — через
// сервисы API (те же проверки, что в интерфейсе), от имени пользователя в роли «Руководитель организации».
// Плановый вес приходит на stdin (JSON из `test-athletes.ts plan`). Без --apply — только предпросмотр.
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { CabinetRole } from '@sde/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { type AuthUser, RequestContextStore } from '../src/common/context/request-context';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { ApplicationsService } from '../src/modules/registrations/application/applications.service';
import { EligibilityService } from '../src/modules/registrations/application/eligibility.service';
import { EntriesService } from '../src/modules/registrations/application/entries.service';
import { EntryDecisionsService } from '../src/modules/registrations/application/entry-decisions.service';

const TEST_CLUB_SLUG = 'test-athletes-club';
/** Роли кабинета, в которых пробуем одобрить участников: организатор турнира или его секретарь (судья). */
const STAFF_ROLES: CabinetRole[] = ['ORGANIZATION_HEAD', 'REFEREE', 'ADMIN'];

interface PlanItem {
  publicId: string;
  category: number;
  weightGrams: number;
}

const out = (line: string): boolean => process.stdout.write(`${line}\n`);

async function readPlan(): Promise<Map<string, PlanItem>> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const plan = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PlanItem[];
  return new Map(plan.map((p) => [p.publicId, p]));
}

const errorText = (e: unknown): string =>
  e instanceof Error
    ? `${e.message} ${JSON.stringify((e as { details?: unknown }).details ?? '')}`
    : String(e);

async function main(): Promise<void> {
  const [email, competitionPart] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (!email || !competitionPart)
    throw new Error('Использование: enter <email> "<часть названия турнира>" [--apply]');
  const plan = await readPlan();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { useLogger: false });
  await app.init();
  try {
    await run(app, email, competitionPart, plan, apply);
  } finally {
    await app.close();
  }
}

type As = <T>(who: AuthUser, fn: () => Promise<T>) => Promise<T>;
interface Choice {
  athleteId: string;
  categoryId: string;
  weightGrams: number;
}

async function findCompetition(db: PrismaService, part: string): Promise<{ id: string; name: string }> {
  const competitions = await db.competition.findMany({
    where: { name: { contains: part, mode: 'insensitive' } },
    select: { id: true, name: true, status: true },
  });
  if (competitions.length !== 1) {
    for (const c of competitions) out(`  ${c.name} (${c.status})`);
    throw new Error(
      competitions.length === 0
        ? `Нет турнира, в названии которого есть «${part}».`
        : 'Подходит несколько турниров — уточните название.',
    );
  }
  const competition = competitions[0] as { id: string; name: string; status: string };
  out(`Турнир: ${competition.name} (статус ${competition.status})`);
  return competition;
}

/**
 * Категория турнира под плановый вес: из подходящих по возрасту и полу — та, в которую попадает вес. Уже заявленные
 * на этот турнир спортсмены пропускаются.
 */
async function chooseCategories(
  app: NestExpressApplication,
  as: As,
  head: AuthUser,
  competitionId: string,
  clubId: string,
  plan: Map<string, PlanItem>,
): Promise<Choice[]> {
  const db = app.get(PrismaService);
  const athletes = await db.athleteProfile.findMany({
    where: { publicId: { in: [...plan.keys()] }, memberships: { some: { organizationId: clubId } } },
    select: { id: true, publicId: true, person: { select: { lastName: true, firstName: true } } },
    orderBy: { publicId: 'asc' },
  });
  const already = new Set(
    (
      await db.entry.findMany({
        where: { competitionId, athleteId: { in: athletes.map((a) => a.id) }, status: { not: 'WITHDRAWN' } },
        select: { athleteId: true },
      })
    ).map((e) => e.athleteId),
  );
  out(`Тестовых спортсменов в клубе: ${athletes.length}, из них уже заявлены на турнир: ${already.size}`);
  const eligibility = app.get(EligibilityService);
  const chosen: Choice[] = [];
  const byCategory = new Map<string, number>();
  const unmatched: string[] = [];
  for (const a of athletes.filter((x) => !already.has(x.id))) {
    const p = plan.get(a.publicId) as PlanItem;
    const res = await as(head, () =>
      eligibility.eligibleCategories(head, competitionId, {
        athleteId: a.id,
        declaredWeightGrams: p.weightGrams,
      }),
    );
    const category = res.eligible.find((c) => c.weightMatch === true);
    if (!category) {
      unmatched.push(`${a.person.lastName} ${a.person.firstName} (${(p.weightGrams / 1000).toFixed(1)} кг)`);
      continue;
    }
    chosen.push({ athleteId: a.id, categoryId: category.id, weightGrams: p.weightGrams });
    byCategory.set(category.name.ru, (byCategory.get(category.name.ru) ?? 0) + 1);
  }
  if (byCategory.size > 0) out('Будут заявлены в категории:');
  for (const [name, n] of byCategory) out(`  ${name} — ${n}`);
  if (unmatched.length > 0) {
    out(`Без подходящей категории в турнире (${unmatched.length}):`);
    for (const n of unmatched) out(`  ${n}`);
  }
  return chosen;
}

/** Заявка клуба на турнир (новая или уже начатая), участники и подача заявки. */
async function enter(
  app: NestExpressApplication,
  as: As,
  head: AuthUser,
  competitionId: string,
  clubId: string,
  chosen: Choice[],
): Promise<string> {
  const db = app.get(PrismaService);
  const applications = app.get(ApplicationsService);
  const entries = app.get(EntriesService);
  const existing = await db.application.findFirst({
    where: { competitionId, organizationId: clubId, status: { not: 'CANCELLED' } },
    select: { id: true },
  });
  const applicationId =
    existing?.id ??
    (await as(head, () => applications.create(head, competitionId, { organizationId: clubId }))).id;
  for (const c of chosen)
    await as(head, () =>
      entries.add(head, applicationId, {
        athleteId: c.athleteId,
        categoryId: c.categoryId,
        declaredWeightGrams: c.weightGrams,
      }),
    );
  out(`\nВ заявку добавлено: ${chosen.length}.`);
  const current = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
  if (current.status === 'DRAFT') {
    await as(head, () => applications.transition(head, applicationId, current.version, { to: 'SUBMITTED' }));
    out('Заявка подана.');
  }
  return applicationId;
}

async function run(
  app: NestExpressApplication,
  email: string,
  competitionPart: string,
  plan: Map<string, PlanItem>,
  apply: boolean,
): Promise<void> {
  const db = app.get(PrismaService);
  const u = await db.user.findUnique({ where: { email } });
  if (!u) throw new Error(`Нет пользователя с почтой ${email}.`);
  const club = await db.organization.findUnique({ where: { slug: TEST_CLUB_SLUG } });
  if (!club) throw new Error('Нет «Тестового клуба» — сначала добавьте спортсменов (add).');
  const competition = await findCompetition(db, competitionPart);
  const user = (activeRole: CabinetRole): AuthUser => ({
    id: u.id,
    sessionId: randomUUID(),
    permissionsVersion: u.permissionsVersion,
    totpEnabled: u.totpEnabledAt !== null,
    personId: u.personId,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    via: 'cookie',
    activeRole,
  });
  const as: As = (who, fn) =>
    RequestContextStore.run(
      { traceId: 'test-athletes', ip: null, userAgent: null, locale: 'ru', user: who },
      fn,
    );
  const head = user('ORGANIZATION_HEAD');
  const chosen = await chooseCategories(app, as, head, competition.id, club.id, plan);
  if (!apply) {
    out('\nЭто предпросмотр — заявка не подана. Чтобы заявить, запустите ту же команду с --apply.');
    return;
  }
  const applicationId = await enter(app, as, head, competition.id, club.id, chosen);
  await approve(app, applicationId, user, as);
}

/** Одобрить участников и заявку, если у пользователя есть права секретаря турнира в одной из ролей кабинета. */
async function approve(
  app: NestExpressApplication,
  applicationId: string,
  user: (role: CabinetRole) => AuthUser,
  as: As,
): Promise<void> {
  const db = app.get(PrismaService);
  const decisions = app.get(EntryDecisionsService);
  const applications = app.get(ApplicationsService);
  let lastError = '';
  for (const role of STAFF_ROLES) {
    const staff = user(role);
    const pending = await db.entry.findMany({
      where: { applicationId, status: 'PENDING' },
      select: { id: true, version: true },
    });
    let approved = 0;
    try {
      for (const e of pending) {
        await as(staff, () => decisions.decide(staff, e.id, e.version, { decision: 'APPROVED' }));
        approved += 1;
      }
      const current = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
      if (current.status !== 'APPROVED')
        await as(staff, () =>
          applications.transition(staff, applicationId, current.version, { to: 'APPROVED' }),
        );
    } catch (e) {
      lastError = errorText(e);
      if (approved === 0) continue;
      throw e;
    }
    out(`Участники одобрены: ${approved}, заявка одобрена.`);
    return;
  }
  out(`Одобрить не удалось (${lastError.trim()}): одобрите заявку в интерфейсе турнира.`);
}

main().catch((e: unknown) => {
  process.stderr.write(`\nОшибка: ${errorText(e)}\n`);
  process.exit(1);
});
