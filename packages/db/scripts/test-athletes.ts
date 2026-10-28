// Тестовые спортсмены для пробного турнира на рабочем сайте: 40 вымышленных юношей и девушек 2012 г. р. (в 2026 году
// им 14 по году рождения — подходят и в группу «12–14 лет», и в «14–16 лет»), привязанных к организации пользователя и
// к нему как к тренеру, если он тренер. Нет у пользователя клуба — создаётся «Тестовый клуб» (slug test-athletes-club),
// пользователь в нём руководитель и тренер: без клуба спортсменов не заявить на турнир. У каждого спортсмена —
// разряд и три согласия (без согласия на обработку ПДн заявка не принимается). Вес хранится не у спортсмена,
// а в заявке: плановый вес и категория печатаются списком, их вводят при заявке или на взвешивании.
//
// Запуск — deploy/server/test-athletes.sh. Режимы:
//   add <email> [--org <часть названия>] [--apply] — без --apply только показывает, что будет сделано;
//   remove [--apply]                                 — удаляет всех тестовых спортсменов и тестовый клуб.
// Тестовые спортсмены помечены публичным номером «TESTATHL…», клуб — slug — по ним их находит удаление.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { type Prisma, PrismaClient } from '../generated/client';
import { uuidv7 } from '../src/uuid';

const envFile = path.resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MARK = 'TESTATHL';
const testPublicId = (n: number): string => `${MARK}${BASE58[Math.floor(n / 58)]}${BASE58[n % 58]}ZZ`;

/** Роли в организации, от которых добавляются спортсмены: руководитель клуба — первым. */
const ORG_ROLES = ['CLUB_MANAGER', 'ORGANIZER', 'FEDERATION_ADMIN', 'COACH'];
const TEST_CLUB = { slug: 'test-athletes-club', name: 'Тестовый клуб', shortName: 'Тестовый клуб' };
const RANKS = ['YOUTH_1', 'SPORT_3', 'YOUTH_2', 'SPORT_2', 'YOUTH_1', 'SPORT_3', 'YOUTH_3'];

interface TestAthlete {
  lastName: string;
  firstName: string;
  middleName: string;
  gender: 'MALE' | 'FEMALE';
  /** Весовая категория (до, кг) — есть в обеих группах — и плановый вес. */
  category: number;
  weight: number;
}

// Юноши: 50 кг — 8, 55 кг — 7, 60 кг — 6, 66 кг — 4, 72 кг — 3. Девушки: 47 кг — 5, 51 кг — 4, 55 кг — 3.
// Разное число в категориях — чтобы увидеть и полную сетку, и маленькую.
const M = (lastName: string, firstName: string, middleName: string, category: number, weight: number) =>
  ({ lastName, firstName, middleName, gender: 'MALE', category, weight }) as const;
const F = (lastName: string, firstName: string, middleName: string, category: number, weight: number) =>
  ({ lastName, firstName, middleName, gender: 'FEMALE', category, weight }) as const;

const ATHLETES: TestAthlete[] = [
  M('Абрамов', 'Никита', 'Сергеевич', 50, 49.2),
  M('Белов', 'Артём', 'Игоревич', 50, 48.6),
  M('Васильев', 'Егор', 'Дмитриевич', 50, 49.8),
  M('Гаврилов', 'Матвей', 'Андреевич', 50, 47.3),
  M('Данилов', 'Иван', 'Олегович', 50, 48.9),
  M('Ершов', 'Тимофей', 'Павлович', 50, 46.8),
  M('Жуков', 'Максим', 'Алексеевич', 50, 49.5),
  M('Зайцев', 'Глеб', 'Викторович', 50, 47.9),
  M('Ильин', 'Даниил', 'Романович', 55, 54.1),
  M('Карпов', 'Кирилл', 'Евгеньевич', 55, 53.6),
  M('Лебедев', 'Арсений', 'Николаевич', 55, 54.8),
  M('Макаров', 'Лев', 'Константинович', 55, 52.4),
  M('Назаров', 'Марк', 'Владимирович', 55, 54.3),
  M('Осипов', 'Фёдор', 'Михайлович', 55, 51.7),
  M('Павлов', 'Ярослав', 'Юрьевич', 55, 53.2),
  M('Рябов', 'Михаил', 'Артёмович', 60, 59.4),
  M('Семёнов', 'Александр', 'Ильич', 60, 58.7),
  M('Тихонов', 'Роман', 'Сергеевич', 60, 59.9),
  M('Уваров', 'Степан', 'Денисович', 60, 57.5),
  M('Фролов', 'Савелий', 'Андреевич', 60, 58.2),
  M('Харитонов', 'Захар', 'Петрович', 60, 56.9),
  M('Царёв', 'Богдан', 'Олегович', 66, 65.3),
  M('Чернов', 'Илья', 'Витальевич', 66, 64.6),
  M('Шестаков', 'Георгий', 'Борисович', 66, 63.8),
  M('Щербаков', 'Платон', 'Аркадьевич', 66, 65.9),
  M('Юдин', 'Святослав', 'Григорьевич', 72, 71.2),
  M('Яковлев', 'Демид', 'Станиславович', 72, 70.4),
  M('Афанасьев', 'Всеволод', 'Валерьевич', 72, 69.1),
  F('Борисова', 'Анна', 'Сергеевна', 47, 46.5),
  F('Голубева', 'Мария', 'Андреевна', 47, 45.8),
  F('Дмитриева', 'София', 'Игоревна', 47, 46.9),
  F('Егорова', 'Алиса', 'Павловна', 47, 44.7),
  F('Зуева', 'Виктория', 'Олеговна', 47, 46.2),
  F('Киселёва', 'Полина', 'Дмитриевна', 51, 50.4),
  F('Лапина', 'Варвара', 'Николаевна', 51, 49.6),
  F('Морозова', 'Ева', 'Алексеевна', 51, 50.8),
  F('Никитина', 'Дарья', 'Евгеньевна', 51, 48.3),
  F('Орлова', 'Ксения', 'Романовна', 55, 54.2),
  F('Попова', 'Вероника', 'Михайловна', 55, 53.5),
  F('Романова', 'Елизавета', 'Викторовна', 55, 54.9),
];

const birthDate = (n: number): Date => new Date(Date.UTC(2012, (n * 5) % 12, ((n * 7) % 27) + 1));
const today = new Date(new Date().toISOString().slice(0, 10));
type Tx = Prisma.TransactionClient;
const out = (line: string): boolean => process.stdout.write(`${line}\n`);
const fmtDate = (d: Date): string => d.toISOString().slice(0, 10).split('-').reverse().join('.');
const fmtKg = (kg: number): string => kg.toFixed(1).replace('.', ',');

function usage(): never {
  process.stderr.write(
    'Использование: test-athletes.ts add <email> [--org <часть названия>] [--apply] | remove [--apply]\n',
  );
  process.exit(2);
}

function printList(): void {
  out('\nСписок (вес вводится при заявке на турнир — у спортсмена его нет):');
  ATHLETES.forEach((a, i) => {
    const name = `${a.lastName} ${a.firstName} ${a.middleName}`;
    const g = a.gender === 'MALE' ? 'юн.' : 'дев.';
    out(
      `  ${String(i + 1).padStart(2)}. ${name.padEnd(38)} ${fmtDate(birthDate(i + 1))}  ${g.padEnd(4)}  до ${a.category} кг, вес ${fmtKg(a.weight)}`,
    );
  });
}

interface Target {
  userId: string;
  coachId: string | null;
  org: { id: string; name: string };
  /** Клуба у пользователя нет — тестовый клуб создаётся вместе со спортсменами. */
  createClub: boolean;
}

/** Организация пользователя, куда добавить спортсменов, и его профиль тренера. */
async function resolveTarget(db: PrismaClient, email: string, orgFilter: string | null): Promise<Target> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, displayName: true, personId: true },
  });
  if (!user) throw new Error(`Нет пользователя с почтой ${email}.`);
  const memberships = await db.organizationMembership.findMany({
    where: {
      userId: user.id,
      status: 'ACTIVE',
      role: { code: { in: ORG_ROLES } },
      organization: { deletedAt: null },
      OR: [{ validTo: null }, { validTo: { gte: today } }],
    },
    select: { role: { select: { code: true } }, organization: { select: { id: true, name: true } } },
  });
  const coach = user.personId
    ? await db.coachProfile.findUnique({ where: { personId: user.personId }, select: { id: true } })
    : null;
  const orgs = new Map<string, { id: string; name: string; rank: number }>();
  for (const m of memberships) {
    const rank = ORG_ROLES.indexOf(m.role.code);
    const prev = orgs.get(m.organization.id);
    if (!prev || rank < prev.rank) orgs.set(m.organization.id, { ...m.organization, rank });
  }
  const needle = orgFilter?.toLowerCase() ?? '';
  const candidates = [...orgs.values()].filter((o) => o.name.toLowerCase().includes(needle));
  out(`Пользователь: ${user.displayName} (${email})`);
  out(`Профиль тренера: ${coach ? 'есть — спортсмены будут и в «Мои спортсмены» тренера' : 'нет'}`);
  const base = { userId: user.id, coachId: coach?.id ?? null };
  if (orgs.size === 0 && !orgFilter) {
    out(
      `Организация: у пользователя нет клуба — будет создан «${TEST_CLUB.name}», он в нём руководитель и тренер`,
    );
    return { ...base, org: { id: uuidv7(), name: TEST_CLUB.name }, createClub: true };
  }
  if (candidates.length !== 1) {
    out('Организации пользователя:');
    for (const o of orgs.values()) out(`  ${o.name}`);
    throw new Error(
      candidates.length === 0
        ? `Ни одна организация не подходит под --org «${orgFilter}».`
        : 'Организаций несколько — укажите нужную: --org <часть названия>.',
    );
  }
  const org = candidates[0] as { id: string; name: string };
  out(`Организация: ${org.name}`);
  return { ...base, org, createClub: false };
}

/** Действующие тексты согласий (по одному на вид): общие согласия нужны для заявки и допуска. */
async function consentTemplates(db: PrismaClient): Promise<string[]> {
  const templates = await db.consentTemplate.findMany({
    where: { locale: 'ru', publishedAt: { not: null }, retiredAt: null },
    orderBy: { version: 'desc' },
    select: { id: true, kind: true },
  });
  const byKind = new Map<string, string>();
  for (const t of templates) if (!byKind.has(t.kind)) byKind.set(t.kind, t.id);
  if (!byKind.has('PD_PROCESSING'))
    throw new Error('Нет опубликованного текста согласия на обработку ПДн — без него заявку не подать.');
  return [...byKind.values()];
}

/** Тестовый клуб: активный, корень иерархии; пользователь — руководитель и тренер (как после одобрения заявок). */
async function createTestClub(tx: Tx, t: Target): Promise<void> {
  const { id } = t.org;
  await tx.organization.create({
    data: { id, type: 'CLUB', ...TEST_CLUB, countryCode: 'RU', status: 'ACTIVE', createdById: t.userId },
  });
  await tx.$executeRaw`INSERT INTO organization_closure (ancestor_id, descendant_id, depth) VALUES (${id}::uuid, ${id}::uuid, 0)`;
  const roles = await tx.role.findMany({
    where: { code: { in: ['CLUB_MANAGER', 'COACH'] } },
    select: { id: true },
  });
  await tx.organizationMembership.createMany({
    data: roles.map((r) => ({
      id: uuidv7(),
      organizationId: id,
      userId: t.userId,
      roleId: r.id,
      status: 'ACTIVE' as const,
      validFrom: today,
    })),
  });
  if (t.coachId)
    await tx.coachMembership.create({
      data: { id: uuidv7(), coachId: t.coachId, organizationId: id, validFrom: today, createdById: t.userId },
    });
  await tx.user.update({ where: { id: t.userId }, data: { permissionsVersion: { increment: 1 } } });
}

async function insertAthlete(
  tx: Tx,
  n: number,
  a: TestAthlete,
  t: Target,
  templateIds: string[],
): Promise<void> {
  const [personId, athleteId] = [uuidv7(), uuidv7()];
  const createdById = t.userId;
  await tx.person.create({
    data: {
      id: personId,
      lastName: a.lastName,
      firstName: a.firstName,
      middleName: a.middleName,
      birthDate: birthDate(n),
      gender: a.gender,
      countryCode: 'RU',
      createdById,
    },
  });
  await tx.athleteProfile.create({
    data: { id: athleteId, personId, publicId: testPublicId(n), createdById },
  });
  await tx.athleteMembership.create({
    data: {
      id: uuidv7(),
      athleteId,
      organizationId: t.org.id,
      isPrimary: true,
      validFrom: today,
      createdById,
    },
  });
  if (t.coachId)
    await tx.athleteCoach.create({
      data: { id: uuidv7(), athleteId, coachId: t.coachId, isPrimary: true, validFrom: today, createdById },
    });
  await tx.athleteRankRecord.create({
    data: {
      id: uuidv7(),
      athleteId,
      sportRankCode: RANKS[n % RANKS.length] as string,
      assignedAt: new Date(Date.UTC(2025, 4, 15)),
      orderRef: 'тестовые данные',
      createdById,
    },
  });
  await tx.consent.createMany({
    data: templateIds.map((templateId) => ({
      id: uuidv7(),
      subjectPersonId: personId,
      givenByPersonId: personId,
      templateId,
      method: 'ELECTRONIC' as const,
      givenAt: new Date(),
      recordedById: createdById,
    })),
  });
}

async function add(db: PrismaClient, email: string, orgFilter: string | null, apply: boolean): Promise<void> {
  const target = await resolveTarget(db, email, orgFilter);
  const existing = await db.athleteProfile.count({ where: { publicId: { startsWith: MARK } } });
  if (existing > 0)
    throw new Error(
      `Тестовые спортсмены уже есть (${existing}). Повторно не добавляются; удалить — режим remove.`,
    );
  const templateIds = await consentTemplates(db);
  const groups = await db.ageGroup.findMany({
    where: { deletedAt: null },
    orderBy: { ageFrom: 'asc' },
    select: { nameRu: true },
  });
  out(`Возрастные группы на сайте: ${groups.map((g) => g.nameRu).join('; ') || 'нет'}`);
  printList();
  if (!apply) {
    out('\nЭто предпросмотр — база не изменена. Чтобы добавить, запустите ту же команду с --apply.');
    return;
  }
  await db.$transaction(
    async (tx) => {
      if (target.createClub) await createTestClub(tx, target);
      for (const [i, a] of ATHLETES.entries()) await insertAthlete(tx, i + 1, a, target, templateIds);
    },
    { timeout: 60_000 },
  );
  out(`\nГотово: добавлено ${ATHLETES.length} тестовых спортсменов в «${target.org.name}».`);
}

async function remove(db: PrismaClient, apply: boolean): Promise<void> {
  const athletes = await db.athleteProfile.findMany({
    where: { publicId: { startsWith: MARK } },
    select: { id: true, personId: true },
  });
  const club = await db.organization.findUnique({
    where: { slug: TEST_CLUB.slug },
    select: { id: true, memberships: { select: { userId: true } } },
  });
  out(`Тестовых спортсменов: ${athletes.length}`);
  out(`Тестовый клуб: ${club ? 'есть, будет удалён' : 'нет'}`);
  if (athletes.length === 0 && !club) return;
  const athleteIds = athletes.map((a) => a.id);
  const personIds = athletes.map((a) => a.personId);

  const entries = await db.entry.findMany({
    where: { athleteId: { in: athleteIds } },
    select: { competition: { select: { name: true } } },
  });
  const applications = club
    ? await db.application.findMany({
        where: { organizationId: club.id },
        select: { competition: { select: { name: true } } },
      })
    : [];
  if (entries.length > 0 || applications.length > 0) {
    const names = [...new Set([...entries, ...applications].map((e) => e.competition.name))];
    out('Они заявлены на турниры:');
    for (const name of names) out(`  ${name}`);
    throw new Error(
      'Сначала удалите эти тестовые турниры (или снимите заявки), затем запустите удаление снова.',
    );
  }
  if (!apply) {
    out('Это предпросмотр — база не изменена. Чтобы удалить, запустите ту же команду с --apply.');
    return;
  }
  await db.$transaction(
    async (tx) => {
      await tx.consent.deleteMany({ where: { subjectPersonId: { in: personIds } } });
      await tx.athleteRankRecord.deleteMany({ where: { athleteId: { in: athleteIds } } });
      await tx.athleteCoach.deleteMany({ where: { athleteId: { in: athleteIds } } });
      await tx.athleteMembership.deleteMany({ where: { athleteId: { in: athleteIds } } });
      await tx.athleteProfile.deleteMany({ where: { id: { in: athleteIds } } });
      await tx.person.deleteMany({ where: { id: { in: personIds } } });
      if (club) await removeTestClub(tx, club);
    },
    { timeout: 60_000 },
  );
  out(`Готово: удалено ${athletes.length} тестовых спортсменов${club ? ' и тестовый клуб' : ''}.`);
}

async function removeTestClub(
  tx: Tx,
  club: { id: string; memberships: { userId: string | null }[] },
): Promise<void> {
  const userIds = [...new Set(club.memberships.flatMap((m) => (m.userId ? [m.userId] : [])))];
  await tx.organizationMembership.deleteMany({ where: { organizationId: club.id } });
  await tx.coachMembership.deleteMany({ where: { organizationId: club.id } });
  await tx.organizationClosure.deleteMany({ where: { descendantId: club.id } });
  await tx.organization.delete({ where: { id: club.id } });
  await tx.user.updateMany({
    where: { id: { in: userIds } },
    data: { permissionsVersion: { increment: 1 } },
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const orgAt = args.indexOf('--org');
  const orgFilter = orgAt >= 0 ? (args[orgAt + 1] ?? usage()) : null;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Нет переменной DATABASE_URL.');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    if (args[0] === 'add' && args[1] && !args[1].startsWith('--')) await add(db, args[1], orgFilter, apply);
    else if (args[0] === 'remove') await remove(db, apply);
    else usage();
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  // Ссылка из другой таблицы (подписка, документ…) не даёт удалить спортсмена — откат, база не изменена.
  process.stderr.write(`\nОшибка: ${msg}\nБаза не изменена.\n`);
  process.exit(1);
});
