// Integration: документы (API.md, 4.6; IMPLEMENTATION_PLAN, Phase 3): загрузка тренером, проверка секретарём
// турнира, доступ без прав → 403 / 404 и запись в журнал, неподдерживаемый тип → VALIDATION_ERROR.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@sde/db';
import {
  createOrg,
  createTestApp,
  createUser,
  login,
  resetData,
  sentEmails,
  type Session,
  type TestApp,
} from './helpers/app';
import { athleteInput, competitionStaff, givePerson, PDF, PNG, send, upload } from './helpers/phase3';

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

interface World {
  clubA: string;
  coach: Session;
  otherCoach: Session;
  foreignCoach: Session;
  manager: Session;
  athleteId: string;
}

async function world(): Promise<World> {
  const clubA = await createOrg(t, { type: 'CLUB' });
  const clubB = await createOrg(t, { type: 'CLUB' });
  const mk = async (org: string, role: 'COACH' | 'CLUB_MANAGER', last: string) => {
    const u = await createUser(t, { orgs: [{ organizationId: org, role }] });
    await givePerson(t, u.id, { lastName: last, firstName: 'Тест', birthDate: '1985-01-01' });
    return login(t, u.email);
  };
  const coach = await mk(clubA, 'COACH', 'Тренеров');
  const w = {
    clubA,
    coach,
    otherCoach: await mk(clubA, 'COACH', 'Соседов'),
    foreignCoach: await mk(clubB, 'COACH', 'Чужаков'),
    manager: await mk(clubA, 'CLUB_MANAGER', 'Директоров'),
    athleteId: (await send(coach, 'post', '/api/v1/athletes', athleteInput(clubA))).body.data.id as string,
  };
  return w;
}

async function medical(w: World, competitionId?: string): Promise<{ id: string; version: number }> {
  const fileId = await upload(t, w.coach, 'DOCUMENT', PDF, 'application/pdf', 'справка.pdf');
  const r = await send(w.coach, 'post', '/api/v1/documents', {
    typeCode: 'MEDICAL_CERTIFICATE',
    fileId,
    owner: { athleteId: w.athleteId },
    competitionId,
    expirationDate: '2099-12-31',
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { id: r.body.data.id as string, version: r.body.data.version as number };
}

describe('upload and access', () => {
  it('the coach uploads a document; access without rights is 403 or 404 and always logged', async () => {
    const w = await world();
    const doc = await medical(w);
    const own = await w.coach.agent.get(`/api/v1/documents/${doc.id}`).expect(200);
    expect(own.body.data).toMatchObject({
      typeCode: 'MEDICAL_CERTIFICATE',
      status: 'UPLOADED',
      owner: { type: 'ATHLETE', athleteId: w.athleteId },
      file: { originalName: 'справка.pdf', mimeType: 'application/pdf' },
    });
    expect(own.body.data.allowedActions).toEqual(['document.view', 'document.delete']);

    // Тренер того же клуба видит спортсмена, но не его документы (◐ COACH_OWN) → 403; чужой клуб → 404.
    expect((await w.otherCoach.agent.get(`/api/v1/documents/${doc.id}`)).status).toBe(403);
    expect((await w.foreignCoach.agent.get(`/api/v1/documents/${doc.id}`)).status).toBe(404);
    expect((await w.foreignCoach.agent.get(`/api/v1/documents/${doc.id}/download-url`)).status).toBe(404);
    const log = await t.admin.dataAccessLog.findMany({
      where: { resourceId: doc.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(log.map((l) => l.action)).toEqual(['VIEW', 'DENIED', 'DENIED', 'DENIED']);

    // Руководитель клуба видит всё по клубу; ссылка на скачивание — 60 секунд и запись DOWNLOAD.
    const url = await w.manager.agent.get(`/api/v1/documents/${doc.id}/download-url`).expect(200);
    expect(url.body.data.url).toMatch(/^memory:\/\/PRIVATE_DOCUMENTS\/.+\?expires=60$/);
    expect(await t.admin.dataAccessLog.count({ where: { resourceId: doc.id, action: 'DOWNLOAD' } })).toBe(1);
    const fileId = (await t.admin.document.findUniqueOrThrow({ where: { id: doc.id } })).fileId;
    expect((await w.foreignCoach.agent.get(`/api/v1/files/${fileId}/download-url`)).status).toBe(404);
    expect((await w.manager.agent.get(`/api/v1/files/${fileId}/download-url`)).status).toBe(200);

    const listOther = await w.otherCoach.agent.get('/api/v1/documents').expect(200);
    expect(listOther.body.data).toEqual([]);
    const listManager = await w.manager.agent
      .get('/api/v1/documents')
      .query({ athleteId: w.athleteId })
      .expect(200);
    expect(listManager.body.data.map((d: { id: string }) => d.id)).toEqual([doc.id]);
  });

  it('rejects unsupported file types, foreign files and expired documents', async () => {
    const w = await world();
    const webp = await send(w.coach, 'post', '/api/v1/files/uploads', {
      purpose: 'DOCUMENT',
      fileName: 'scan.webp',
      mimeType: 'image/webp',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    });
    expect(webp.body.error).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE', category: 'VALIDATION_ERROR' });
    expect(webp.status).toBe(400);
    const svg = await send(w.coach, 'post', '/api/v1/files/uploads', {
      purpose: 'DOCUMENT',
      fileName: 'x.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    });
    expect(svg.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const png = await upload(t, w.coach, 'DOCUMENT', PNG, 'image/png', 'полис.png');
    const stolen = await send(w.manager, 'post', '/api/v1/documents', {
      typeCode: 'INSURANCE_POLICY',
      fileId: png,
      owner: { athleteId: w.athleteId },
    });
    expect(stolen.body.error.details.fields).toEqual([{ path: 'fileId', code: 'invalid_file' }]);
    const expired = await send(w.coach, 'post', '/api/v1/documents', {
      typeCode: 'INSURANCE_POLICY',
      fileId: png,
      owner: { athleteId: w.athleteId },
      expirationDate: '2020-01-01',
    });
    expect(expired.body.error.code).toBe('DOCUMENT_EXPIRED');
    const noOwner = await send(w.coach, 'post', '/api/v1/documents', {
      typeCode: 'OTHER',
      fileId: png,
      owner: {},
    });
    expect(noOwner.status).toBe(400);
    const foreign = await send(w.foreignCoach, 'post', '/api/v1/documents', {
      typeCode: 'OTHER',
      fileId: png,
      owner: { athleteId: w.athleteId },
    });
    expect(foreign.status).toBe(404);
    // Загрузивший может удалить документ, пока его не взяли на проверку.
    const ok = await send(w.coach, 'post', '/api/v1/documents', {
      typeCode: 'INSURANCE_POLICY',
      fileId: png,
      owner: { athleteId: w.athleteId },
    });
    await send(w.coach, 'delete', `/api/v1/documents/${ok.body.data.id}`).expect(204);
    expect((await w.coach.agent.get(`/api/v1/documents/${ok.body.data.id}`)).status).toBe(404);
  });
});

describe('review in the competition context', () => {
  it('the secretary of the competition verifies or rejects; others cannot; decisions are final', async () => {
    const w = await world();
    const competitionId = uuidv7();
    const otherCompetition = uuidv7();
    const secretaryUser = await createUser(t);
    await competitionStaff(t, secretaryUser.id, competitionId, 'SECRETARY');
    const strangerSecretaryUser = await createUser(t);
    await competitionStaff(t, strangerSecretaryUser.id, otherCompetition, 'SECRETARY');
    const secretary = await login(t, secretaryUser.email);
    const strangerSecretary = await login(t, strangerSecretaryUser.email);

    const unknown = await send(w.coach, 'post', '/api/v1/documents', {
      typeCode: 'OTHER',
      fileId: await upload(t, w.coach, 'DOCUMENT', PDF, 'application/pdf'),
      owner: { athleteId: w.athleteId },
      competitionId: uuidv7(),
    });
    expect(unknown.body.error.details.fields).toEqual([{ path: 'competitionId', code: 'not_found' }]);

    const doc = await medical(w, competitionId);
    const queue = await secretary.agent.get('/api/v1/documents').query({ status: 'UPLOADED' }).expect(200);
    expect(
      queue.body.data.map((d: { id: string; allowedActions: string[] }) => [d.id, d.allowedActions]),
    ).toEqual([[doc.id, ['document.view', 'document.verify']]]);
    expect((await strangerSecretary.agent.get(`/api/v1/documents/${doc.id}`)).status).toBe(404);
    expect(
      (
        await send(
          strangerSecretary,
          'post',
          `/api/v1/documents/${doc.id}/transitions`,
          { to: 'VERIFIED' },
          1,
        )
      ).status,
    ).toBe(404);
    expect(
      (await send(w.coach, 'post', `/api/v1/documents/${doc.id}/transitions`, { to: 'VERIFIED' }, 1)).status,
    ).toBe(403);

    const review = await send(
      secretary,
      'post',
      `/api/v1/documents/${doc.id}/transitions`,
      { to: 'UNDER_REVIEW' },
      1,
    );
    expect(review.body.data.status).toBe('UNDER_REVIEW');
    const noReason = await send(
      secretary,
      'post',
      `/api/v1/documents/${doc.id}/transitions`,
      { to: 'REJECTED' },
      2,
    );
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const rejected = await send(
      secretary,
      'post',
      `/api/v1/documents/${doc.id}/transitions`,
      { to: 'REJECTED', reason: 'Нет печати врача' },
      2,
    );
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', rejectReason: 'Нет печати врача' });
    const again = await send(
      secretary,
      'post',
      `/api/v1/documents/${doc.id}/transitions`,
      { to: 'VERIFIED' },
      3,
    );
    expect(again.body.error.code).toBe('DOCUMENT_ALREADY_REVIEWED');
    const [mail] = await sentEmails(t, 'document.rejected');
    expect(mail?.params).toMatchObject({
      documentType: 'Медицинская справка о допуске',
      reason: 'Нет печати врача',
    });
    expect(await t.admin.outboxEvent.count({ where: { type: 'document.rejected' } })).toBe(1);

    const second = await medical(w, competitionId);
    const verified = await send(
      secretary,
      'post',
      `/api/v1/documents/${second.id}/transitions`,
      { to: 'VERIFIED' },
      1,
    );
    expect(verified.body.data).toMatchObject({ status: 'VERIFIED', reviewedBy: { id: secretaryUser.id } });
    expect((await send(w.coach, 'delete', `/api/v1/documents/${second.id}`)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
    const audit = await t.admin.auditLog.findMany({
      where: { entityId: doc.id, action: 'document.status_changed' },
    });
    expect(audit.map((a) => a.reason)).toEqual([null, 'Нет печати врача']);
  });

  it('a document without a competition is verified only by the platform', async () => {
    const w = await world();
    const doc = await medical(w);
    const admin = await login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });
    const pa = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, { totp: true });
    expect((await pa.agent.get(`/api/v1/documents/${doc.id}`)).status).toBe(403);
    const r = await send(admin, 'post', `/api/v1/documents/${doc.id}/transitions`, { to: 'VERIFIED' }, 1);
    expect(r.body.data.status).toBe('VERIFIED');
  });
});
