// Integration: администрирование, аудит в транзакции, неизменяемость журналов, файлы, справочники, настройки.
import { createHash } from 'node:crypto';
import { PERMISSION_CODES, ROLE_CODES, ROLE_PERMISSIONS } from '@sde/contracts';
import { PrismaClient } from '@sde/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../src/common/context/request-context';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuditService } from '../src/modules/audit';
import { TEST_ENV } from './test-env';
import { createOrg, createTestApp, createUser, csrfAgent, login, PASSWORD, resetData, type Session, type TestApp } from './helpers/app';

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

const superAdmin = async (): Promise<Session> => login(t, (await createUser(t, { platform: ['SUPER_ADMIN'] })).email, { totp: true });

describe('audit log', () => {
  it('is written inside the business transaction and rolled back with it', async () => {
    const db = t.app.get(PrismaService);
    const audit = t.app.get(AuditService);
    const ctx = { traceId: 'trace-rollback-test', ip: '203.0.113.7', userAgent: 'vitest', locale: 'ru' as const, user: null };
    await expect(
      RequestContextStore.run(ctx, () =>
        db.tx(async (tx) => {
          await audit.record(tx, { action: 'setting.updated', entityType: 'SystemSetting' });
          throw new Error('business rule failed after audit');
        }),
      ),
    ).rejects.toThrow('business rule failed');
    expect(await t.admin.auditLog.count({ where: { traceId: 'trace-rollback-test' } })).toBe(0);

    await RequestContextStore.run(ctx, () => db.tx((tx) => audit.record(tx, { action: 'setting.updated', entityType: 'SystemSetting' })));
    const row = await t.admin.auditLog.findFirstOrThrow({ where: { traceId: 'trace-rollback-test' } });
    expect(row).toMatchObject({ actorType: 'SYSTEM', ip: '203.0.113.7', userAgent: 'vitest' });
  });

  it('application role cannot update or delete audit records', async () => {
    const appRole = new PrismaClient({ datasourceUrl: TEST_ENV.DATABASE_URL });
    try {
      await appRole.$executeRaw`INSERT INTO audit_log (id, actor_type, action, entity_type) VALUES (gen_random_uuid(), 'SYSTEM', 'x', 'y')`;
      await expect(appRole.$executeRaw`UPDATE audit_log SET action = 'tampered'`).rejects.toThrow(/permission denied/);
      await expect(appRole.$executeRaw`DELETE FROM audit_log`).rejects.toThrow(/permission denied/);
      await expect(appRole.$executeRaw`DELETE FROM data_access_log`).rejects.toThrow(/permission denied/);
    } finally {
      await appRole.$disconnect();
    }
  });

  it('platform audit view filters by entity and hides raw IPs', async () => {
    const sa = await superAdmin();
    const org = await sa.agent
      .post('/api/v1/organizations')
      .set('x-csrf-token', sa.csrf)
      .send({ type: 'CLUB', name: 'Клуб аудита', shortName: 'Аудит', countryCode: 'RU' })
      .expect(201);
    const res = await sa.agent.get('/api/v1/admin/audit-logs').query({ entityType: 'Organization', entityId: org.body.data.id }).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ action: 'organization.created', actor: { type: 'USER' } });
    expect(res.body.data[0].ipMasked).toMatch(/\*$/);
  });
});

describe('user administration', () => {
  it('blocks a user: all sessions end immediately; unblock restores access', async () => {
    const sa = await superAdmin();
    const victim = await createUser(t);
    const v = await login(t, victim.email);
    await v.agent.get('/api/v1/me').expect(200);

    const noReason = await sa.agent.post(`/api/v1/admin/users/${victim.id}/block`).set('x-csrf-token', sa.csrf).send({});
    expect(noReason.body.error.code).toBe('VALIDATION_FAILED');
    const blocked = await sa.agent
      .post(`/api/v1/admin/users/${victim.id}/block`)
      .set('x-csrf-token', sa.csrf)
      .send({ reason: 'Нарушение правил платформы' })
      .expect(200);
    expect(blocked.body.data.status).toBe('BLOCKED');
    const after = await v.agent.get('/api/v1/me');
    expect(after.status).toBe(401);
    await sa.agent.post(`/api/v1/admin/users/${victim.id}/unblock`).set('x-csrf-token', sa.csrf).send({ reason: 'Ошибка модератора' }).expect(200);
    await login(t, victim.email);
  });

  it('platform roles require TOTP on the recipient; the last SUPER_ADMIN cannot be removed', async () => {
    const saUser = await createUser(t, { platform: ['SUPER_ADMIN'] });
    const sa = await login(t, saUser.email, { totp: true });
    const plain = await createUser(t);
    const noTotp = await sa.agent
      .post(`/api/v1/admin/users/${plain.id}/platform-roles`)
      .set('x-csrf-token', sa.csrf)
      .send({ roleCode: 'PLATFORM_ADMIN', reason: 'Поддержка платформы' });
    expect(noTotp.body.error.code).toBe('TOTP_REQUIRED');

    const withTotp = await createUser(t, { totp: true });
    await sa.agent
      .post(`/api/v1/admin/users/${withTotp.id}/platform-roles`)
      .set('x-csrf-token', sa.csrf)
      .send({ roleCode: 'PLATFORM_ADMIN', reason: 'Поддержка платформы' })
      .expect(201);
    const pa = await t.admin.user.findUniqueOrThrow({ where: { id: withTotp.id } });
    expect(pa.permissionsVersion).toBeGreaterThan(1);

    const last = await sa.agent
      .delete(`/api/v1/admin/users/${saUser.id}/platform-roles/SUPER_ADMIN`)
      .set('x-csrf-token', sa.csrf)
      .send({ reason: 'Попытка снять последнего' });
    expect(last.status).toBe(422);
    expect(last.body.error).toMatchObject({ code: 'TRANSITION_PRECONDITIONS_NOT_MET', details: { failed: ['last_super_admin'] } });
  });

  it('platform admin sees users but cannot manage roles or settings', async () => {
    const pa = await login(t, (await createUser(t, { platform: ['PLATFORM_ADMIN'] })).email, { totp: true });
    const list = await pa.agent.get('/api/v1/admin/users').query({ role: 'PLATFORM_ADMIN' }).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect((await pa.agent.get('/api/v1/admin/settings')).status).toBe(403);
    const target = await createUser(t, { totp: true });
    const grant = await pa.agent
      .post(`/api/v1/admin/users/${target.id}/platform-roles`)
      .set('x-csrf-token', pa.csrf)
      .send({ roleCode: 'SUPER_ADMIN', reason: 'Эскалация привилегий' });
    expect(grant.status).toBe(403);
  });

  it('platform roles without enabled TOTP give no rights', async () => {
    const u = await createUser(t, { platform: ['SUPER_ADMIN'], totp: false });
    const s = await login(t, u.email);
    expect((await s.agent.get('/api/v1/admin/users')).status).toBe(403);
  });
});

describe('permission catalog', () => {
  it('database catalog equals packages/contracts (data migration is in sync)', async () => {
    const perms = await t.admin.permission.findMany();
    expect(perms.map((p) => p.code).sort()).toEqual([...PERMISSION_CODES].sort());
    const grants = await t.admin.rolePermission.findMany({ include: { role: true } });
    const fromDb = grants.map((g) => `${g.role.code}:${g.permissionCode}:${g.mode}`).sort();
    const fromCode = ROLE_CODES.flatMap((r) => Object.entries(ROLE_PERMISSIONS[r]).map(([p, m]) => `${r}:${p}:${m}`)).sort();
    expect(fromDb).toEqual(fromCode);
  });
});

describe('files', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

  it('uploads a logo through staging, verifies it and attaches it to an organization', async () => {
    const club = await createOrg(t);
    const cm = await login(t, (await createUser(t, { orgs: [{ organizationId: club, role: 'CLUB_MANAGER' }] })).email);
    const ticket = await cm.agent
      .post('/api/v1/files/uploads')
      .set('x-csrf-token', cm.csrf)
      .send({ purpose: 'ORGANIZATION_LOGO', fileName: '../../логотип.png', mimeType: 'image/png', sizeBytes: png.length, sha256: sha(png) })
      .expect(201);
    const fileId = ticket.body.data.fileId as string;
    expect(ticket.body.data.fields.key).toBe(`incoming/${fileId}`);
    t.storage.put('PRIVATE_DOCUMENTS', `incoming/${fileId}`, png, 'image/png');

    const done = await cm.agent.post(`/api/v1/files/${fileId}/complete`).set('x-csrf-token', cm.csrf).expect(200);
    expect(done.body.data).toMatchObject({ status: 'AVAILABLE', originalName: 'логотип.png', bucket: 'PUBLIC_MEDIA' });
    expect(done.body.data.publicUrl).toMatch(/^http:\/\/storage\.test\/test-public\/\d{4}\/\d{2}\/.+\.png$/);
    expect(t.storage.objects.has(`PRIVATE_DOCUMENTS/incoming/${fileId}`)).toBe(false);

    const orgRow = await t.admin.organization.findUniqueOrThrow({ where: { id: club } });
    const updated = await cm.agent
      .patch(`/api/v1/organizations/${club}`)
      .set('x-csrf-token', cm.csrf)
      .set('if-match', `"v${orgRow.version}"`)
      .send({ logoFileId: fileId })
      .expect(200);
    expect(updated.body.data.logoUrl).toBe(done.body.data.publicUrl);

    // Чужой файл привязать нельзя.
    const other = await createOrg(t);
    const otherCm = await login(t, (await createUser(t, { orgs: [{ organizationId: other, role: 'CLUB_MANAGER' }] })).email);
    const steal = await otherCm.agent
      .patch(`/api/v1/organizations/${other}`)
      .set('x-csrf-token', otherCm.csrf)
      .set('if-match', '"v1"')
      .send({ logoFileId: fileId });
    expect(steal.body.error.details.fields).toEqual([{ path: 'logoFileId', code: 'invalid_file' }]);
  });

  it('rejects disguised content, wrong types, oversized files and purposes without a policy', async () => {
    const u = await login(t, (await createUser(t)).email);
    const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const ticket = await u.agent
      .post('/api/v1/files/uploads')
      .set('x-csrf-token', u.csrf)
      .send({ purpose: 'ORGANIZATION_LOGO', fileName: 'logo.png', mimeType: 'image/png', sizeBytes: fake.length, sha256: sha(fake) })
      .expect(201);
    t.storage.put('PRIVATE_DOCUMENTS', `incoming/${ticket.body.data.fileId}`, fake);
    const mismatch = await u.agent.post(`/api/v1/files/${ticket.body.data.fileId}/complete`).set('x-csrf-token', u.csrf);
    expect(mismatch.body.error.code).toBe('FILE_CONTENT_MISMATCH');
    expect((await t.admin.storedFile.findUniqueOrThrow({ where: { id: ticket.body.data.fileId } })).status).toBe('REJECTED');

    const svg = await u.agent
      .post('/api/v1/files/uploads')
      .set('x-csrf-token', u.csrf)
      .send({ purpose: 'ORGANIZATION_LOGO', fileName: 'logo.svg', mimeType: 'image/svg+xml', sizeBytes: 10, sha256: sha(fake) });
    expect(svg.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const big = await u.agent
      .post('/api/v1/files/uploads')
      .set('x-csrf-token', u.csrf)
      .send({ purpose: 'ORGANIZATION_LOGO', fileName: 'logo.png', mimeType: 'image/png', sizeBytes: 3 * 1024 * 1024, sha256: sha(png) });
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');
    const doc = await u.agent
      .post('/api/v1/files/uploads')
      .set('x-csrf-token', u.csrf)
      .send({ purpose: 'DOCUMENT', fileName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: sha(png) });
    expect(doc.status).toBe(403);
  });

  it('private download links go only to allowed users, every attempt is logged', async () => {
    const owner = await createUser(t);
    const o = await login(t, owner.email);
    const fileId = '01920000-0000-7000-8000-0000000000f1';
    await t.admin.storedFile.create({
      data: {
        id: fileId,
        bucket: 'PRIVATE_DOCUMENTS',
        purpose: 'DOCUMENT',
        storageKey: '2026/09/private.pdf',
        originalName: 'справка.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10n,
        sha256: sha(png),
        status: 'AVAILABLE',
        uploadedById: owner.id,
      },
    });
    const own = await o.agent.get(`/api/v1/files/${fileId}/download-url`).expect(200);
    expect(own.body.data.url).toContain('expires=60');
    const stranger = await login(t, (await createUser(t)).email);
    expect((await stranger.agent.get(`/api/v1/files/${fileId}/download-url`)).status).toBe(404);
    const log = await t.admin.dataAccessLog.findMany({ where: { resourceId: fileId }, orderBy: { occurredAt: 'asc' } });
    expect(log.map((l) => l.action)).toEqual(['DOWNLOAD', 'DENIED']);
  });
});

describe('dictionaries and settings', () => {
  it('public dictionaries are cached and editable only with dictionary.manage', async () => {
    const anon = await csrfAgent(t);
    const regions = await anon.agent.get('/api/v1/dictionaries/regions').query({ countryCode: 'RU' }).expect(200);
    expect(regions.body.data.length).toBe(83);
    expect(regions.headers['cache-control']).toBe('public, max-age=3600');
    const etag = regions.headers.etag as string;
    await anon.agent.get('/api/v1/dictionaries/regions').query({ countryCode: 'RU' }).set('if-none-match', etag).expect(304);
    const ranks = await anon.agent.get('/api/v1/dictionaries/sport-ranks').expect(200);
    expect(ranks.body.data.map((r: { code: string }) => r.code)).toEqual([
      'YOUTH_3', 'YOUTH_2', 'YOUTH_1', 'SPORT_3', 'SPORT_2', 'SPORT_1', 'CMS', 'MS', 'MSIC', 'HMS',
    ]);

    const sa = await superAdmin();
    await sa.agent
      .put('/api/v1/admin/dictionaries/regions/RU-XXX')
      .set('x-csrf-token', sa.csrf)
      .send({ countryCode: 'RU', nameRu: 'Учебный регион', nameEn: 'Training region' })
      .expect(204);
    const again = await anon.agent.get('/api/v1/dictionaries/regions').query({ countryCode: 'RU' }).expect(200);
    expect(again.body.data.length).toBe(84);
    const invalid = await sa.agent.put('/api/v1/admin/dictionaries/document-types/SCAN').set('x-csrf-token', sa.csrf).send({ nameRu: 'x' });
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('settings are validated by schema; disabling self sign-up blocks registration', async () => {
    const sa = await superAdmin();
    const bad = await sa.agent.put('/api/v1/admin/settings/registration.selfSignupEnabled').set('x-csrf-token', sa.csrf).send({ value: 'yes' });
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const unknown = await sa.agent.put('/api/v1/admin/settings/unknown.key').set('x-csrf-token', sa.csrf).send({ value: true });
    expect(unknown.status).toBe(404);
    await sa.agent.put('/api/v1/admin/settings/registration.selfSignupEnabled').set('x-csrf-token', sa.csrf).send({ value: false }).expect(200);
    const list = await sa.agent.get('/api/v1/admin/settings').expect(200);
    expect(list.body.data.find((s: { key: string }) => s.key === 'registration.selfSignupEnabled')).toMatchObject({ value: false, isDefault: false });

    // Кэш настроек в API — 30 секунд; новый экземпляр приложения видит изменение сразу.
    const fresh = await createTestApp();
    try {
      const anon = await csrfAgent(fresh);
      const res = await anon.agent
        .post('/api/v1/auth/register')
        .set('x-csrf-token', anon.csrf)
        .send({ email: 'late@test.local', password: PASSWORD, displayName: 'X', locale: 'ru', acceptTerms: true });
      expect(res.status).toBe(403);
    } finally {
      await fresh.close();
    }
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    await t.http().get('/health').expect(200, { status: 'ok' });
    const ready = await t.http().get('/ready').expect(200);
    expect(ready.body.checks).toEqual({ database: 'ok', redis: 'ok', storage: 'ok' });
  });
});
