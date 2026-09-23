// Приложение для интеграционных тестов: реальный AppModule, реальные PostgreSQL и Redis, хранилище в памяти.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { type EmailTemplate, type RoleCode } from '@sde/contracts';
import { PrismaClient, uuidv7 } from '@sde/db';
import { deriveKey, hashPassword, KEY_PURPOSES, openJson, sealTotpSecret, totpKey } from '@sde/server-kit';
import { Redis } from 'ioredis';
import { authenticator } from 'otplib';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { StorageService } from '../../src/infrastructure/storage/storage.service';
import { applyTestEnv, TEST_ENV } from '../test-env';
import { MemoryStorage } from './memory-storage';

export const PASSWORD = 'Lemon-Tatami-Throw-42';
export const TOTP_SECRET = 'KVKFKRCPNZQUYMLXOVYDSQKJKZDTSRLD';

export interface TestApp {
  app: INestApplication;
  http: () => TestAgent;
  /** Подключение владельца схемы: фикстуры и проверки без ограничений роли приложения. */
  admin: PrismaClient;
  storage: MemoryStorage;
  redis: Redis;
  close: () => Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  applyTestEnv();
  Object.assign(process.env, env);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useClass(MemoryStorage)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { useLogger: false });
  await app.init();
  const admin = new PrismaClient({ datasourceUrl: TEST_ENV.DATABASE_ADMIN_URL });
  const redis = new Redis(TEST_ENV.REDIS_URL);
  return {
    app,
    http: () => request.agent(app.getHttpServer()),
    admin,
    storage: app.get<StorageService, MemoryStorage>(StorageService),
    redis,
    close: async () => {
      await app.close();
      await admin.$disconnect();
      redis.disconnect();
    },
  };
}

/** Очистка данных между файлами тестов; каталог прав и справочники остаются. */
export async function resetData(t: TestApp): Promise<void> {
  await t.admin.$executeRaw`TRUNCATE
    audit_log, data_access_log, outbox_event, processed_event, system_setting, stored_file,
    refresh_token, verification_token, auth_identity, platform_role_assignment,
    organization_membership, competition_membership, organization_closure, organization_legal_details,
    organization, "user", person CASCADE`;
  await t.redis.flushdb();
}

export interface UserFixture {
  id: string;
  email: string;
}

export async function createUser(
  t: TestApp,
  opts: {
    email?: string;
    platform?: RoleCode[];
    orgs?: { organizationId: string; role: RoleCode }[];
    totp?: boolean;
    status?: 'ACTIVE' | 'PENDING_VERIFICATION' | 'BLOCKED';
  } = {},
): Promise<UserFixture> {
  const id = uuidv7();
  const email = opts.email ?? `user-${id.slice(-12)}@test.local`;
  const totp = opts.totp ?? (opts.platform?.length ?? 0) > 0;
  await t.admin.user.create({
    data: {
      id,
      email,
      displayName: `Test ${id.slice(-4)}`,
      status: opts.status ?? 'ACTIVE',
      emailVerifiedAt: opts.status === 'PENDING_VERIFICATION' ? null : new Date(),
      totpSecretEnc: totp ? sealTotpSecret(totpKey(TEST_ENV.TOTP_ENCRYPTION_KEY), id, TOTP_SECRET) : null,
      totpEnabledAt: totp ? new Date() : null,
    },
  });
  await t.admin.authIdentity.create({
    data: {
      id: uuidv7(),
      userId: id,
      provider: 'EMAIL_PASSWORD',
      providerSubject: email,
      secretHash: await hashPassword(PASSWORD),
    },
  });
  for (const code of opts.platform ?? []) {
    const role = await t.admin.role.findUniqueOrThrow({ where: { code } });
    await t.admin.platformRoleAssignment.create({ data: { id: uuidv7(), userId: id, roleId: role.id } });
  }
  for (const m of opts.orgs ?? []) {
    const role = await t.admin.role.findUniqueOrThrow({ where: { code: m.role } });
    await t.admin.organizationMembership.create({
      data: {
        id: uuidv7(),
        organizationId: m.organizationId,
        userId: id,
        roleId: role.id,
        status: 'ACTIVE',
        validFrom: new Date(),
      },
    });
  }
  return { id, email };
}

export async function createOrg(
  t: TestApp,
  opts: {
    type?: 'CLUB' | 'REGIONAL_FEDERATION' | 'ORGANIZER' | 'SPORTS_SCHOOL';
    parentId?: string | null;
    status?: 'ACTIVE' | 'PENDING_REVIEW' | 'SUSPENDED';
  } = {},
): Promise<string> {
  const id = uuidv7();
  await t.admin.organization.create({
    data: {
      id,
      type: opts.type ?? 'CLUB',
      parentId: opts.parentId ?? null,
      name: `Организация ${id.slice(-6)}`,
      shortName: `Орг ${id.slice(-4)}`,
      slug: `org-${id.slice(-12)}`,
      countryCode: 'RU',
      status: opts.status ?? 'ACTIVE',
    },
  });
  await t.admin
    .$executeRaw`INSERT INTO organization_closure (ancestor_id, descendant_id, depth) VALUES (${id}::uuid, ${id}::uuid, 0)`;
  if (opts.parentId) {
    await t.admin.$executeRaw`
      INSERT INTO organization_closure (ancestor_id, descendant_id, depth)
      SELECT ancestor_id, ${id}::uuid, depth + 1 FROM organization_closure WHERE descendant_id = ${opts.parentId}::uuid`;
  }
  return id;
}

export function totpNow(): string {
  return authenticator.generate(TOTP_SECRET);
}

/** Веб-клиент: CSRF-cookie + заголовок, вход, cookie сессии в агенте. */
export interface Session {
  agent: TestAgent;
  csrf: string;
}

export async function csrfAgent(t: TestApp): Promise<Session> {
  const agent = t.http();
  const res = await agent.get('/api/v1/auth/csrf').expect(200);
  return { agent, csrf: (res.body as { data: { csrfToken: string } }).data.csrfToken };
}

export async function login(t: TestApp, email: string, opts: { totp?: boolean } = {}): Promise<Session> {
  const s = await csrfAgent(t);
  const body: Record<string, string> = { email, password: PASSWORD };
  if (opts.totp) body.totpCode = totpNow();
  const res = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send(body);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('sde_csrf='));
  const csrf = cookie ? decodeURIComponent(cookie.split(';')[0]!.slice('sde_csrf='.length)) : s.csrf;
  return { agent: s.agent, csrf };
}

/** Письма из outbox: расшифровка запечатанных параметров, как это делает worker. */
export async function sentEmails(
  t: TestApp,
  template?: EmailTemplate,
): Promise<{ to: string; params: Record<string, string> }[]> {
  const key = deriveKey(TEST_ENV.AUTH_SECRET, KEY_PURPOSES.outboxSecrets);
  const events = await t.admin.outboxEvent.findMany({
    where: { type: 'email.requested' },
    orderBy: { occurredAt: 'asc' },
  });
  return events
    .map((e) => e.payload as { template: EmailTemplate; sealedParams: string })
    .filter((p) => !template || p.template === template)
    .map((p) =>
      openJson<{ to: string; params: Record<string, string> }>(key, p.sealedParams, `email:${p.template}`),
    );
}

export function tokenFromUrl(url: string | undefined): string {
  if (!url) throw new Error('no url');
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error('no token');
  return token;
}
