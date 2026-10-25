// Integration: фото профиля в личном кабинете (PUT /me/avatar) — загрузка с целью AVATAR, привязка к своей записи
// «человек», показ в /me.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, login, resetData, type Session, type TestApp } from './helpers/app';

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

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function uploadAvatar(s: Session): Promise<string> {
  const ticket = await s.agent
    .post('/api/v1/files/uploads')
    .set('x-csrf-token', s.csrf)
    .send({
      purpose: 'AVATAR',
      fileName: 'я.png',
      mimeType: 'image/png',
      sizeBytes: png.length,
      sha256: sha(png),
    })
    .expect(201);
  const fileId = ticket.body.data.fileId as string;
  t.storage.put('PRIVATE_DOCUMENTS', `incoming/${fileId}`, png, 'image/png');
  await s.agent.post(`/api/v1/files/${fileId}/complete`).set('x-csrf-token', s.csrf).expect(200);
  return fileId;
}

const setAvatar = (s: Session, fileId: string | null) =>
  s.agent.put('/api/v1/me/avatar').set('x-csrf-token', s.csrf).send({ fileId });

describe('profile photo', () => {
  it('needs a person record, then is shown in /me and can be removed', async () => {
    const s = await login(t, (await createUser(t)).email);
    const fileId = await uploadAvatar(s);

    const noPerson = await setAvatar(s, fileId);
    expect(noPerson.body.error.code).toBe('VALIDATION_FAILED');
    expect(noPerson.body.error.details.fields).toEqual([{ path: 'fileId', code: 'person_required' }]);

    await s.agent
      .put('/api/v1/me/person')
      .set('x-csrf-token', s.csrf)
      .send({ lastName: 'Судьин', firstName: 'Пётр', birthDate: '1990-05-01', gender: 'MALE' })
      .expect(200);
    const set = await setAvatar(s, fileId).expect(200);
    expect(set.body.data.avatarUrl).toMatch(/^http:\/\/storage\.test\/test-public\/\d{4}\/\d{2}\/.+\.png$/);
    const me = await s.agent.get('/api/v1/me').expect(200);
    expect(me.body.data.avatarUrl).toBe(set.body.data.avatarUrl);
    expect(
      await t.admin.auditLog.count({
        where: { action: 'person.photo_updated', entityId: me.body.data.personId },
      }),
    ).toBe(1);

    const removed = await setAvatar(s, null).expect(200);
    expect(removed.body.data.avatarUrl).toBeNull();
  });

  it('accepts only own files uploaded as AVATAR', async () => {
    const owner = await login(t, (await createUser(t)).email);
    const other = await login(t, (await createUser(t)).email);
    await other.agent
      .put('/api/v1/me/person')
      .set('x-csrf-token', other.csrf)
      .send({ lastName: 'Другой', firstName: 'Иван', birthDate: '1991-02-03', gender: 'MALE' })
      .expect(200);
    const foreign = await setAvatar(other, await uploadAvatar(owner));
    expect(foreign.body.error.details.fields).toEqual([{ path: 'fileId', code: 'invalid_file' }]);
  });
});
