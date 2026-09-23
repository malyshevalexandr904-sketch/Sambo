// Integration: rate limit на входе (API.md, 1.7): 10 в минуту по IP, 5 в минуту по email.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, csrfAgent, resetData, type TestApp } from './helpers/app';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ RATE_LIMIT_ENABLED: 'true' });
});
afterAll(async () => {
  await t.close();
  process.env.RATE_LIMIT_ENABLED = 'false';
});
beforeEach(async () => {
  await resetData(t);
});

describe('rate limiting', () => {
  it('limits login attempts per email to 5 per minute with Retry-After', async () => {
    const u = await createUser(t);
    const s = await csrfAgent(t);
    const statuses: number[] = [];
    let last: { status: number; headers: Record<string, string>; body: { error: { code: string } } } | undefined;
    for (let i = 0; i < 6; i++) {
      last = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: u.email, password: 'wrong-password-x' });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(last?.body.error.code).toBe('RATE_LIMITED');
    expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits auth endpoints per IP to 10 per minute across different emails', async () => {
    const s = await csrfAgent(t);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: `ip-${i}@test.local`, password: 'wrong-password-x' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((x) => x === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
