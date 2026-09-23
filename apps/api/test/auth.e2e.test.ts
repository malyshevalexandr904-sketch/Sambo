// Integration: полный цикл входа (IMPLEMENTATION_PLAN, Phase 2; API.md, 3.1).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  csrfAgent,
  login,
  PASSWORD,
  resetData,
  sentEmails,
  type TestApp,
  tokenFromUrl,
  totpNow,
} from './helpers/app';

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

const cookieValue = (res: { headers: Record<string, unknown> }, name: string): string | undefined => {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const c = cookies.find((x) => x.startsWith(`${name}=`));
  return c?.split(';')[0]?.slice(name.length + 1);
};

describe('registration and email verification', () => {
  it('register → verify email → session → me → logout', async () => {
    const s = await csrfAgent(t);
    await s.agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', s.csrf)
      .send({ email: 'Coach@Test.local', password: PASSWORD, displayName: 'Тренер', locale: 'ru', acceptTerms: true })
      .expect(202, { data: { status: 'VERIFICATION_SENT' } });

    // До подтверждения войти нельзя.
    const early = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: 'coach@test.local', password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const [mail] = await sentEmails(t, 'auth.verify_email');
    expect(mail?.to).toBe('coach@test.local');
    const verified = await s.agent
      .post('/api/v1/auth/verify-email')
      .set('x-csrf-token', s.csrf)
      .send({ token: tokenFromUrl(mail?.params.verifyUrl) })
      .expect(200);
    expect(verified.body.data.status).toBe('ACTIVE');
    const csrf = decodeURIComponent(cookieValue(verified, 'sde_csrf') ?? '');

    const me = await s.agent.get('/api/v1/me').expect(200);
    expect(me.body.data.email).toBe('coach@test.local');
    expect(me.body.data.grants).toEqual({ platform: [], organizations: [], competitions: [] });

    await s.agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);
    const after = await s.agent.get('/api/v1/me');
    expect(after.status).toBe(401);

    // Токен подтверждения одноразовый.
    const again = await s.agent.post('/api/v1/auth/verify-email').set('x-csrf-token', csrf).send({ token: tokenFromUrl(mail?.params.verifyUrl) });
    expect(again.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('does not reveal that an email is taken', async () => {
    await createUser(t, { email: 'taken@test.local' });
    const s = await csrfAgent(t);
    await s.agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', s.csrf)
      .send({ email: 'taken@test.local', password: PASSWORD, displayName: 'X', locale: 'ru', acceptTerms: true })
      .expect(202, { data: { status: 'VERIFICATION_SENT' } });
    const mails = await sentEmails(t);
    expect(mails.map((m) => m.to)).toEqual(['taken@test.local']);
    expect(await sentEmails(t, 'auth.account_exists')).toHaveLength(1);
  });

  it('rejects leaked passwords and invalid bodies with field errors', async () => {
    const s = await csrfAgent(t);
    const leaked = await s.agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', s.csrf)
      .send({ email: 'a@test.local', password: 'qwerty123456', displayName: 'X', locale: 'ru', acceptTerms: true });
    expect(leaked.status).toBe(400);
    expect(leaked.body.error.details.fields).toEqual([{ path: 'password', code: 'password_leaked' }]);

    const invalid = await s.agent.post('/api/v1/auth/register').set('x-csrf-token', s.csrf).send({ email: 'nope', password: 'short', locale: 'xx' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    const paths = (invalid.body.error.details.fields as { path: string }[]).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password', 'displayName', 'locale', 'acceptTerms']));
    expect(invalid.body.error.traceId).toBeTruthy();
  });
});

describe('login', () => {
  it('answers the same for a wrong password and an unknown email', async () => {
    await createUser(t, { email: 'known@test.local' });
    const s = await csrfAgent(t);
    const wrong = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: 'known@test.local', password: 'wrong-password-1' });
    const unknown = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: 'ghost@test.local', password: 'wrong-password-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('blocked accounts cannot sign in', async () => {
    await createUser(t, { email: 'blocked@test.local', status: 'BLOCKED' });
    const s = await csrfAgent(t);
    const res = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: 'blocked@test.local', password: PASSWORD });
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
  });

  it('requires TOTP for users who enabled it and rejects replay of the same code', async () => {
    await createUser(t, { email: 'admin@test.local', platform: ['SUPER_ADMIN'] });
    const s = await csrfAgent(t);
    const noCode = await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: 'admin@test.local', password: PASSWORD });
    expect(noCode.body.error.code).toBe('TOTP_REQUIRED');
    const code = totpNow();
    await s.agent.post('/api/v1/auth/login').set('x-csrf-token', s.csrf).send({ email: 'admin@test.local', password: PASSWORD, totpCode: code }).expect(200);
    // Вход выдаёт новый CSRF-токен, поэтому повтор — из нового клиента.
    const other = await csrfAgent(t);
    const replay = await other.agent.post('/api/v1/auth/login').set('x-csrf-token', other.csrf).send({ email: 'admin@test.local', password: PASSWORD, totpCode: code });
    expect(replay.body.error.code).toBe('TOTP_INVALID');
  });

  it('rejects unsafe cookie requests without a valid CSRF token', async () => {
    const u = await createUser(t);
    const s = await login(t, u.email);
    const res = await s.agent.patch('/api/v1/me').send({ displayName: 'Новое имя' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    const forged = await s.agent.patch('/api/v1/me').set('x-csrf-token', 'forged.value').send({ displayName: 'Новое имя' });
    expect(forged.body.error.code).toBe('CSRF_TOKEN_INVALID');
    await s.agent.patch('/api/v1/me').set('x-csrf-token', s.csrf).send({ displayName: 'Новое имя' }).expect(200);
  });
});

describe('refresh token rotation', () => {
  it('rotates, and reuse of an old token revokes the whole session (Bearer client)', async () => {
    const u = await createUser(t);
    const http = t.http();
    const loginRes = await http
      .post('/api/v1/auth/login')
      .set('x-auth-mode', 'bearer')
      .send({ email: u.email, password: PASSWORD })
      .expect(200);
    const first = loginRes.body.data.tokens as { accessToken: string; refreshToken: string };
    await http.get('/api/v1/me').set('authorization', `Bearer ${first.accessToken}`).expect(200);

    const rotated = await http.post('/api/v1/auth/refresh').set('x-auth-mode', 'bearer').send({ refreshToken: first.refreshToken }).expect(200);
    const second = rotated.body.data as { accessToken: string; refreshToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const reuse = await http.post('/api/v1/auth/refresh').set('x-auth-mode', 'bearer').send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // Всё семейство отозвано: и новый refresh, и выданный access token.
    const afterReuse = await http.post('/api/v1/auth/refresh').set('x-auth-mode', 'bearer').send({ refreshToken: second.refreshToken });
    expect(afterReuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    const me = await http.get('/api/v1/me').set('authorization', `Bearer ${second.accessToken}`);
    expect(me.status).toBe(401);
    const audit = await t.admin.auditLog.count({ where: { action: 'auth.refresh_reuse_detected', entityId: u.id } });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it('refreshes the web session from the cookie', async () => {
    const u = await createUser(t);
    const s = await login(t, u.email);
    const res = await s.agent.post('/api/v1/auth/refresh').set('x-csrf-token', s.csrf).expect(200);
    expect(res.body.data).toEqual({ status: 'REFRESHED' });
    expect(cookieValue(res, 'sde_at')).toBeTruthy();
  });
});

describe('password recovery and sessions', () => {
  it('forgot → reset revokes all sessions; old password stops working', async () => {
    const u = await createUser(t, { email: 'reset@test.local' });
    const s = await login(t, u.email);
    const anon = await csrfAgent(t);
    await anon.agent.post('/api/v1/auth/password/forgot').set('x-csrf-token', anon.csrf).send({ email: 'reset@test.local' }).expect(202);
    await anon.agent.post('/api/v1/auth/password/forgot').set('x-csrf-token', anon.csrf).send({ email: 'ghost@test.local' }).expect(202);
    const mails = await sentEmails(t, 'auth.password_reset');
    expect(mails).toHaveLength(1);
    const newPassword = 'Another-Strong-Pass-7';
    await anon.agent
      .post('/api/v1/auth/password/reset')
      .set('x-csrf-token', anon.csrf)
      .send({ token: tokenFromUrl(mails[0]?.params.resetUrl), newPassword })
      .expect(204);
    expect((await s.agent.get('/api/v1/me')).status).toBe(401);
    const old = await anon.agent.post('/api/v1/auth/login').set('x-csrf-token', anon.csrf).send({ email: u.email, password: PASSWORD });
    expect(old.body.error.code).toBe('INVALID_CREDENTIALS');
    await anon.agent.post('/api/v1/auth/login').set('x-csrf-token', anon.csrf).send({ email: u.email, password: newPassword }).expect(200);
    expect(await sentEmails(t, 'auth.password_changed')).toHaveLength(1);
  });

  it('lists own sessions and revokes one of them', async () => {
    const u = await createUser(t);
    const a = await login(t, u.email);
    const b = await login(t, u.email);
    const list = await a.agent.get('/api/v1/auth/sessions').expect(200);
    const sessions = list.body.data as { id: string; current: boolean; ipMasked: string }[];
    expect(sessions).toHaveLength(2);
    const other = sessions.find((x) => !x.current);
    expect(other).toBeDefined();
    await a.agent.delete(`/api/v1/auth/sessions/${other?.id}`).set('x-csrf-token', a.csrf).expect(204);
    expect((await b.agent.get('/api/v1/me')).status).toBe(401);
    expect((await a.agent.get('/api/v1/me')).status).toBe(200);

    const stranger = await createUser(t);
    const c = await login(t, stranger.email);
    const foreign = await c.agent.delete(`/api/v1/auth/sessions/${sessions.find((x) => x.current)?.id}`).set('x-csrf-token', c.csrf);
    expect(foreign.status).toBe(404);
  });

  it('change password keeps the current session and ends the others', async () => {
    const u = await createUser(t);
    const a = await login(t, u.email);
    const b = await login(t, u.email);
    await a.agent
      .post('/api/v1/auth/password/change')
      .set('x-csrf-token', a.csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'Changed-Pass-2026-x' })
      .expect(204);
    expect((await a.agent.get('/api/v1/me')).status).toBe(200);
    expect((await b.agent.get('/api/v1/me')).status).toBe(401);
  });
});

describe('TOTP management', () => {
  it('setup → enable returns 10 recovery codes; a recovery code works once', async () => {
    const u = await createUser(t);
    const s = await login(t, u.email);
    const setup = await s.agent.post('/api/v1/auth/totp/setup').set('x-csrf-token', s.csrf).expect(200);
    const uri = setup.body.data.otpauthUri as string;
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    const { authenticator } = await import('otplib');
    const enabled = await s.agent.post('/api/v1/auth/totp/enable').set('x-csrf-token', s.csrf).send({ code: authenticator.generate(secret) }).expect(200);
    const codes = enabled.body.data.recoveryCodes as string[];
    expect(codes).toHaveLength(10);

    const anon = await csrfAgent(t);
    await anon.agent.post('/api/v1/auth/login').set('x-csrf-token', anon.csrf).send({ email: u.email, password: PASSWORD, totpCode: codes[0] }).expect(200);
    const other = await csrfAgent(t);
    const reuse = await other.agent.post('/api/v1/auth/login').set('x-csrf-token', other.csrf).send({ email: u.email, password: PASSWORD, totpCode: codes[0] });
    expect(reuse.body.error.code).toBe('TOTP_INVALID');
  });

  it('platform administrators cannot disable TOTP', async () => {
    const u = await createUser(t, { platform: ['PLATFORM_ADMIN'] });
    const s = await login(t, u.email, { totp: true });
    const res = await s.agent.post('/api/v1/auth/totp/disable').set('x-csrf-token', s.csrf).send({ code: '000000' });
    expect(res.status).toBe(403);
  });
});
