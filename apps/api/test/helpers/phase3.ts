// Фикстуры Phase 3: человек пользователя, загрузка файлов, персонал турнира, тексты согласий, запросы.
import { createHash } from 'node:crypto';
import type { RoleCode, UploadPurpose } from '@sde/contracts';
import { uuidv7 } from '@sde/db';
import type { Session, TestApp } from './app';

export const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.alloc(200, 0x20),
  Buffer.from('\n%%EOF'),
]);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Запись «человек» у пользователя: тренеру, представителю, судье. */
export async function givePerson(
  t: TestApp,
  userId: string,
  person: {
    lastName: string;
    firstName: string;
    birthDate: string;
    gender?: 'MALE' | 'FEMALE';
    middleName?: string;
  },
): Promise<string> {
  const id = uuidv7();
  await t.admin.person.create({
    data: {
      id,
      lastName: person.lastName,
      firstName: person.firstName,
      middleName: person.middleName ?? null,
      birthDate: new Date(`${person.birthDate}T00:00:00.000Z`),
      gender: person.gender ?? 'MALE',
    },
  });
  await t.admin.user.update({ where: { id: userId }, data: { personId: id } });
  return id;
}

/** Загрузка файла, как это делает веб: presigned POST → объект в хранилище → complete. */
export async function upload(
  t: TestApp,
  s: Session,
  purpose: UploadPurpose,
  body: Buffer,
  mimeType: string,
  fileName = 'file.pdf',
): Promise<string> {
  const ticket = await s.agent
    .post('/api/v1/files/uploads')
    .set('x-csrf-token', s.csrf)
    .send({ purpose, fileName, mimeType, sizeBytes: body.length, sha256: sha(body) });
  if (ticket.status !== 201) throw new Error(`upload ticket ${ticket.status} ${JSON.stringify(ticket.body)}`);
  const fileId = ticket.body.data.fileId as string;
  t.storage.put(ticket.body.data.fields.bucket, ticket.body.data.fields.key, body, mimeType);
  const done = await s.agent.post(`/api/v1/files/${fileId}/complete`).set('x-csrf-token', s.csrf);
  if (done.status !== 200) throw new Error(`upload complete ${done.status} ${JSON.stringify(done.body)}`);
  return fileId;
}

/** Персонал турнира (CompetitionMembership). Таблица турнира появится в Phase 4. */
export async function competitionStaff(
  t: TestApp,
  userId: string,
  competitionId: string,
  role: RoleCode,
): Promise<void> {
  const r = await t.admin.role.findUniqueOrThrow({ where: { code: role } });
  await t.admin.competitionMembership.create({
    data: { id: uuidv7(), competitionId, userId, roleId: r.id, status: 'ACTIVE' },
  });
}

const BODY = (kind: string): string =>
  `Я, законный представитель, даю согласие (${kind}) оператору на обработку персональных данных ребёнка в целях участия в соревнованиях. Учебный текст.`;

/** Опубликованные тексты трёх видов согласий (ru). */
export async function publishConsentTemplates(t: TestApp): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const kind of ['PD_PROCESSING', 'PD_DISTRIBUTION', 'HEALTH_DATA'] as const) {
    const id = uuidv7();
    await t.admin.consentTemplate.create({
      data: {
        id,
        kind,
        version: 1,
        locale: 'ru',
        operatorName: 'ИП Учебный Оператор',
        bodyMarkdown: BODY(kind),
        publishedAt: new Date(),
      },
    });
    ids[kind] = id;
  }
  return ids;
}

type Method = 'post' | 'patch' | 'put' | 'delete';

/** Запрос с CSRF и, если нужно, If-Match. */
export function send(s: Session, method: Method, url: string, body: unknown = {}, version?: number) {
  const r = s.agent[method](url).set('x-csrf-token', s.csrf);
  if (version !== undefined) r.set('if-match', `"v${version}"`);
  return r.send(body as object);
}

export const athleteInput = (organizationId: string, over: Record<string, unknown> = {}) => ({
  person: { lastName: 'Самбистов', firstName: 'Пётр', birthDate: '2013-05-17', gender: 'MALE' },
  organizationId,
  ...over,
});
