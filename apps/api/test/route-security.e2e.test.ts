// Автотест безопасности маршрутов (PERMISSIONS.md, 7; IMPLEMENTATION_PLAN, Phase 2):
// каждый маршрут объявляет доступ; без входа закрытые маршруты отвечают 401; без прав — 403 или 404.
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTE_ACCESS, type RouteAccess } from '../src/modules/access';
import { createOrg, createTestApp, createUser, csrfAgent, login, resetData, type Session, type TestApp } from './helpers/app';

interface Route {
  method: string;
  path: string;
  access: RouteAccess | undefined;
  name: string;
}

const UNPREFIXED = new Set(['/health', '/ready']);

function collectRoutes(t: TestApp): Route[] {
  const routes: Route[] = [];
  const modules = t.app.get(ModulesContainer);
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
      if (!cls) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
      const proto = cls.prototype as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(proto)) {
        const handler = proto[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (sub === undefined || method === undefined) continue;
        const raw = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
        const path = UNPREFIXED.has(raw) ? raw : `/api/v1${raw}`;
        const access =
          (Reflect.getMetadata(ROUTE_ACCESS, handler) as RouteAccess | undefined) ??
          (Reflect.getMetadata(ROUTE_ACCESS, cls) as RouteAccess | undefined);
        routes.push({ method: RequestMethod[method], path, access, name: `${cls.name}.${key}` });
      }
    }
  }
  return routes;
}

let t: TestApp;
let routes: Route[];
let orgId: string;
let noRights: Session;

const PARAMS: Record<string, () => string> = {
  id: () => orgId,
  membershipId: () => '01920000-0000-7000-8000-00000000ffff',
  name: () => 'countries',
  code: () => 'ZZ',
  roleCode: () => 'SUPER_ADMIN',
  key: () => 'registration.selfSignupEnabled',
};

function concrete(path: string): string {
  return path.replace(/:(\w+)/g, (_, p: string) => (PARAMS[p] ?? (() => '01920000-0000-7000-8000-00000000eeee'))());
}

function send(s: Session, method: string, path: string): Promise<{ status: number; body: { error?: { code: string } } }> {
  const agent = s.agent;
  const url = concrete(path);
  switch (method) {
    case 'GET':
      return agent.get(url);
    case 'POST':
      return agent.post(url).set('x-csrf-token', s.csrf).set('if-match', '"v1"').send({});
    case 'PUT':
      return agent.put(url).set('x-csrf-token', s.csrf).send({});
    case 'PATCH':
      return agent.patch(url).set('x-csrf-token', s.csrf).set('if-match', '"v1"').send({});
    case 'DELETE':
      return agent.delete(url).set('x-csrf-token', s.csrf).send({ reason: 'automated route test' });
    default:
      throw new Error(`Unsupported method ${method}`);
  }
}

beforeAll(async () => {
  t = await createTestApp();
  await resetData(t);
  routes = collectRoutes(t);
  orgId = await createOrg(t, { type: 'CLUB' });
  const user = await createUser(t);
  noRights = await login(t, user.email);
});
afterAll(async () => {
  await t.close();
});

describe('route security autotest', () => {
  it('discovers the API surface', () => {
    expect(routes.length).toBeGreaterThan(35);
  });

  it('every route declares @Public, @Authenticated or @RequirePermission', () => {
    const undeclared = routes.filter((r) => !r.access).map((r) => `${r.method} ${r.path} (${r.name})`);
    expect(undeclared).toEqual([]);
  });

  it('every route that is not public rejects anonymous requests with 401', async () => {
    const anon = await csrfAgent(t);
    const failures: string[] = [];
    for (const r of routes.filter((x) => x.access?.kind !== 'public')) {
      const res = await send(anon, r.method, r.path);
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status} ${res.body.error?.code ?? ''}`);
    }
    expect(failures).toEqual([]);
  });

  it('every @RequirePermission route answers 403 or 404 to a user without rights', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => x.access?.kind === 'permission')) {
      const res = await send(noRights, r.method, r.path);
      if (res.status !== 403 && res.status !== 404) failures.push(`${r.method} ${r.path} → ${res.status} ${res.body.error?.code ?? ''}`);
    }
    expect(failures).toEqual([]);
  });

  it('identifiers in the body never widen access (role, userId, organizationId are ignored)', async () => {
    const res = await noRights.agent
      .get('/api/v1/admin/users')
      .query({ role: 'SUPER_ADMIN', userId: 'x' })
      .set('x-user-id', '01920000-0000-7000-8001-000000000001');
    expect(res.status).toBe(403);
    const patch = await noRights.agent
      .patch(`/api/v1/organizations/${orgId}`)
      .set('x-csrf-token', noRights.csrf)
      .set('if-match', '"v1"')
      .send({ name: 'Захват', roles: ['SUPER_ADMIN'], organizationId: orgId });
    expect(patch.status).toBe(403);
  });
});
