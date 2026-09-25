// Integration: импорт спортсменов (API.md, 4.4) и идемпотентность (API.md, 1.5). Разбор файла выполняет
// worker (у него свои тесты); здесь отчёт разбора записывается так же, как это делает worker.
import { randomUUID } from 'node:crypto';
import { type ImportReport, normalizeImportRow } from '@sde/contracts';
import { findAthleteDuplicates, type Prisma } from '@sde/db';
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
import { athleteInput, givePerson, send, upload } from './helpers/phase3';

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

const CSV = Buffer.from('Фамилия;Имя;Дата рождения;Пол\nИванов;Пётр;17.05.2013;м\n', 'utf8');

function start(s: Session, body: unknown, key?: string) {
  const r = s.agent.post('/api/v1/athletes/imports').set('x-csrf-token', s.csrf);
  if (key) r.set('idempotency-key', key);
  return r.send(body as object);
}

/** То же, что делает worker после чтения файла: строки → нормализация → дубли → PARSED. */
async function parseLikeWorker(jobId: string, rows: Record<string, string>[]): Promise<void> {
  const report: ImportReport = {
    totalRows: rows.length,
    validRows: 0,
    errorRows: 0,
    duplicateRows: 0,
    rows: [],
    results: null,
  };
  for (const [i, raw] of rows.entries()) {
    const { data, errors } = normalizeImportRow(raw);
    const duplicates = data ? await findAthleteDuplicates(t.admin, data) : [];
    report.rows.push({ row: i + 2, data, errors, duplicates, coach: null, result: null });
  }
  report.validRows = report.rows.filter((r) => r.data).length;
  report.errorRows = report.rows.length - report.validRows;
  report.duplicateRows = report.rows.filter((r) => r.duplicates.length > 0).length;
  await t.admin.importJob.update({
    where: { id: jobId },
    data: { status: 'PARSED', parsedAt: new Date(), report: report as unknown as Prisma.InputJsonValue },
  });
}

describe('athlete import', () => {
  it('requires an idempotency key and replays the stored response', async () => {
    const club = await createOrg(t, { type: 'CLUB' });
    const m = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: club, role: 'CLUB_MANAGER' }] })).email,
    );
    const fileId = await upload(t, m, 'IMPORT', CSV, 'text/csv', 'спортсмены.csv');
    expect((await start(m, { organizationId: club, fileId })).body.error.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect((await start(m, { organizationId: club, fileId }, 'not-a-uuid')).status).toBe(400);
    const key = randomUUID();
    const first = await start(m, { organizationId: club, fileId }, key);
    expect(first.status).toBe(202);
    expect(first.body.data).toMatchObject({ status: 'PENDING', fileName: 'спортсмены.csv', report: null });
    const replay = await start(m, { organizationId: club, fileId }, key);
    expect(replay.status).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await t.admin.importJob.count()).toBe(1);
    expect((await start(m, { organizationId: club, fileId: randomUUID() }, key)).body.error.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    const event = await t.admin.outboxEvent.findFirst({ where: { type: 'athlete.import_requested' } });
    expect(event?.payload).toEqual({ importJobId: first.body.data.id });
    // Тренер без права импорта и чужое задание.
    const coach = await login(
      t,
      (await createUser(t, { orgs: [{ organizationId: club, role: 'COACH' }] })).email,
    );
    expect((await start(coach, { organizationId: club, fileId }, randomUUID())).status).toBe(403);
    expect((await coach.agent.get(`/api/v1/athletes/imports/${first.body.data.id}`)).status).toBe(404);
  });

  it('commits chosen rows: creates, links an existing athlete, skips; a second commit is refused', async () => {
    const club = await createOrg(t, { type: 'CLUB' });
    const school = await createOrg(t, { type: 'SPORTS_SCHOOL' });
    const mu = await createUser(t, {
      orgs: [
        { organizationId: club, role: 'CLUB_MANAGER' },
        { organizationId: school, role: 'CLUB_MANAGER' },
      ],
    });
    await givePerson(t, mu.id, { lastName: 'Директоров', firstName: 'Иван', birthDate: '1980-01-01' });
    const m = await login(t, mu.email);
    const existing = (await send(m, 'post', '/api/v1/athletes', athleteInput(club))).body.data.id as string;
    const fileId = await upload(t, m, 'IMPORT', CSV, 'text/csv');
    const job = (await start(m, { organizationId: school, fileId }, randomUUID())).body.data;
    expect(
      (
        await send(m, 'post', `/api/v1/athletes/imports/${job.id}/commit`, {
          rows: [{ row: 2, action: 'CREATE' }],
        })
      ).body.error.code,
    ).toBe('INVALID_TRANSITION');
    await parseLikeWorker(job.id, [
      {
        lastName: 'Новиков',
        firstName: 'Илья',
        birthDate: '01.02.2012',
        gender: 'м',
        sportRankCode: 'YOUTH_1',
        rankAssignedAt: '2025-01-10',
      },
      { lastName: 'Самбистов', firstName: 'Пётр', birthDate: '2013-05-17', gender: 'M' },
      { lastName: 'Ошибкин', firstName: '', birthDate: '2013-05-17', gender: 'M' },
      { lastName: 'Пропускова', firstName: 'Анна', birthDate: '2014-03-03', gender: 'Ж' },
    ]);
    const parsed = await m.agent.get(`/api/v1/athletes/imports/${job.id}`).expect(200);
    expect(parsed.body.data.report).toMatchObject({
      totalRows: 4,
      validRows: 3,
      errorRows: 1,
      duplicateRows: 1,
    });
    expect(parsed.body.data.report.rows[1].duplicates[0].athleteId).toBe(existing);

    const committed = await send(m, 'post', `/api/v1/athletes/imports/${job.id}/commit`, {
      rows: [
        { row: 2, action: 'CREATE' },
        { row: 3, action: 'LINK', athleteId: existing },
        { row: 4, action: 'CREATE' },
        { row: 5, action: 'SKIP' },
      ],
    });
    expect(committed.status).toBe(200);
    expect(committed.body.data.status).toBe('COMMITTED');
    expect(committed.body.data.report.results).toEqual({ created: 1, linked: 1, skipped: 1, failed: 1 });
    expect(committed.body.data.report.rows[2].result).toEqual({
      action: 'CREATE',
      athleteId: null,
      error: 'VALIDATION_FAILED',
    });
    const schoolList = await m.agent.get('/api/v1/athletes').query({ organizationId: school }).expect(200);
    expect(schoolList.body.data.map((a: { lastName: string }) => a.lastName).sort()).toEqual([
      'Новиков',
      'Самбистов',
    ]);
    const novikov = schoolList.body.data.find((a: { lastName: string }) => a.lastName === 'Новиков');
    expect(novikov.rankCode).toBe('YOUTH_1');
    expect(
      (
        await send(m, 'post', `/api/v1/athletes/imports/${job.id}/commit`, {
          rows: [{ row: 5, action: 'CREATE' }],
        })
      ).body.error.code,
    ).toBe('INVALID_TRANSITION');
  });
});
