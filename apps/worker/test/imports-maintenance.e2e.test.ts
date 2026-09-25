// Integration (worker): разбор файла импорта с проверками по БД и истечение документов.
import type { S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, uuidv7 } from '@sde/db';
import { createLogger, type Env } from '@sde/server-kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ImportConsumer } from '../src/imports/import.consumer';
import { Maintenance } from '../src/maintenance/maintenance';
import { TEST_DB } from './global-setup';

const db = new PrismaClient({ datasourceUrl: TEST_DB.DATABASE_ADMIN_URL });
const logger = createLogger('silent', 'worker-test');
const env = { STORAGE_BUCKET_PRIVATE: 'test-private' } as Env;
const s3 = {} as S3Client;

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await db.$executeRaw`TRUNCATE import_job, document, athlete_coach, athlete_membership, athlete_profile,
    coach_membership, coach_profile, stored_file, audit_log, organization_closure, organization, "user", person CASCADE`;
});

async function org(): Promise<string> {
  const id = uuidv7();
  await db.organization.create({
    data: {
      id,
      type: 'CLUB',
      name: `Клуб ${id}`,
      shortName: 'Клуб',
      slug: `club-${id.slice(-12)}`,
      countryCode: 'RU',
      status: 'ACTIVE',
    },
  });
  return id;
}

async function person(lastName: string, firstName: string, birthDate: string): Promise<string> {
  const id = uuidv7();
  await db.person.create({
    data: { id, lastName, firstName, birthDate: new Date(`${birthDate}T00:00:00Z`), gender: 'MALE' },
  });
  return id;
}

async function file(uploadedById: string | null, mimeType = 'text/csv'): Promise<string> {
  const id = uuidv7();
  await db.storedFile.create({
    data: {
      id,
      bucket: 'PRIVATE_DOCUMENTS',
      purpose: 'IMPORT',
      storageKey: `2026/09/${id}.csv`,
      originalName: 'import.csv',
      mimeType,
      sizeBytes: 10n,
      sha256: 'a'.repeat(64),
      status: 'AVAILABLE',
      uploadedById,
    },
  });
  return id;
}

describe('import parsing', () => {
  it('builds the preview with coaches of the club and duplicates already in the system', async () => {
    const club = await org();
    const userId = uuidv7();
    const coachPerson = await person('Тренеров', 'Сергей', '1990-01-01');
    await db.user.create({
      data: {
        id: userId,
        email: 'coach@club.local',
        displayName: 'Тренер',
        status: 'ACTIVE',
        personId: coachPerson,
      },
    });
    const coachId = uuidv7();
    await db.coachProfile.create({ data: { id: coachId, personId: coachPerson } });
    await db.coachMembership.create({
      data: { id: uuidv7(), coachId, organizationId: club, validFrom: new Date('2020-01-01') },
    });
    const athletePerson = await person('Самбистов', 'Пётр', '2013-05-17');
    await db.athleteProfile.create({
      data: { id: uuidv7(), personId: athletePerson, publicId: 'AbCdEfGhJkLm' },
    });

    const jobId = uuidv7();
    await db.importJob.create({
      data: { id: jobId, organizationId: club, fileId: await file(userId), createdById: userId },
    });
    const csv = Buffer.from(
      [
        'lastName;firstName;birthDate;gender;coachEmail',
        'Новиков;Илья;01.02.2012;м;coach@club.local',
        'Самбистов;Петр;17.05.2013;м;',
        'Чужой;Тренер;01.02.2012;м;other@club.local',
      ].join('\n'),
    );
    await new ImportConsumer(db, s3, env, logger).parse(jobId, club, 'text/csv', csv);
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('PARSED');
    const report = job.report as {
      totalRows: number;
      rows: { row: number; coach: unknown; duplicates: unknown[]; errors: unknown[] }[];
    };
    expect(report.totalRows).toBe(3);
    expect(report.rows[0]).toMatchObject({
      row: 2,
      coach: { id: coachId, name: 'Тренеров Сергей' },
      errors: [],
    });
    expect(report.rows[1]?.duplicates).toHaveLength(1);
    expect(report.rows[2]?.errors).toEqual([{ path: 'coachEmail', code: 'coach_not_found' }]);
  });

  it('marks unreadable files as FAILED with a file error code', async () => {
    const club = await org();
    const userId = uuidv7();
    await db.user.create({ data: { id: userId, email: 'm@club.local', displayName: 'М', status: 'ACTIVE' } });
    const jobId = uuidv7();
    await db.importJob.create({
      data: { id: jobId, organizationId: club, fileId: await file(userId), createdById: userId },
    });
    await new ImportConsumer(db, s3, env, logger).parse(
      jobId,
      club,
      'text/csv',
      Buffer.from('Фамилия;Имя\nИванов;Иван'),
    );
    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: 'FAILED', errorCode: 'MISSING_COLUMNS' });
  });
});

describe('document expiry', () => {
  it('expires verified documents the day after their expiration date and audits it', async () => {
    const athlete = uuidv7();
    await db.athleteProfile.create({
      data: { id: athlete, personId: await person('Иванов', 'Иван', '2013-01-01'), publicId: 'ZyXwVuTsRqPn' },
    });
    const mk = async (status: 'VERIFIED' | 'UPLOADED', expirationDate: string) => {
      const id = uuidv7();
      await db.document.create({
        data: {
          id,
          typeCode: 'MEDICAL_CERTIFICATE',
          athleteId: athlete,
          fileId: await file(null, 'application/pdf'),
          status,
          expirationDate: new Date(expirationDate),
        },
      });
      return id;
    };
    const old = await mk('VERIFIED', '2026-09-23');
    const today = await mk('VERIFIED', '2026-09-24');
    const unchecked = await mk('UPLOADED', '2026-09-01');
    const maintenance = new Maintenance(db, s3, env, logger);
    expect(await maintenance.expireDocuments(new Date('2026-09-24T00:00:00Z'))).toBe(1);
    const statuses = await db.document.findMany({
      where: { id: { in: [old, today, unchecked] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [old]: 'EXPIRED',
      [today]: 'VERIFIED',
      [unchecked]: 'UPLOADED',
    });
    const audit = await db.auditLog.findFirst({ where: { action: 'document.expired' } });
    expect(audit).toMatchObject({ entityId: old, actorType: 'SYSTEM' });
    expect(await maintenance.expireDocuments(new Date('2026-09-24T00:00:00Z'))).toBe(0);
  });
});
