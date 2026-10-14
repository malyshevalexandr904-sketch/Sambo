// Данные для интеграционных тестов уведомлений дня соревнований (Phase 8b): турнир идёт, два ковра, очередь схваток
// на ковре 1; спортсмены A и B клуба «Буревестник» встречаются в схватке № 14. Получатели: мать A (подтверждённый
// представитель), сам B (учётная запись), тренер клуба (подписан на A и B); не получатели — подписавшийся без
// доступа и бывший член клуба. Плюс тестовое «устройство» Web Push: свои ключи, расшифровка сообщения (RFC 8291) и
// проверка подписи VAPID (RFC 8292) — независимо от библиотеки отправки.
import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify as verifySignature,
} from 'node:crypto';
import { type PrismaClient, publicId, uuidv7 } from '@sde/db';

export const MIN = 60_000;

export const TRUNCATE_MATCH_DAY = `TRUNCATE sync_log, push_subscription, follow, refresh_token, match_schedule,
  session, mat, match_participant, match, entry, application, guardian, athlete_profile, competition_category,
  competition_write_lease, competition, outbox_event, processed_event, notification, notification_preference,
  organization_membership, organization, "user", person CASCADE`;

export interface MatchDayWorld {
  competitionId: string;
  categoryId: string;
  clubId: string;
  mat1: string;
  mat2: string;
  sessionId: string;
  athleteA: string;
  athleteB: string;
  entryA: string;
  entryB: string;
  mother: string;
  selfB: string;
  coach: string;
  outsider: string;
  formerMember: string;
  /** Очередь ковра 1: идёт, две в очереди, A против B (№ 14), B против соперника (позже, вне окна). */
  running: string;
  q1: string;
  q2: string;
  ab: string;
  late: string;
}

async function person(db: PrismaClient, lastName: string, birthDate = '2013-04-01'): Promise<string> {
  const id = uuidv7();
  await db.person.create({
    data: { id, lastName, firstName: 'Тест', birthDate: new Date(birthDate), gender: 'MALE' },
  });
  return id;
}

export async function user(db: PrismaClient, email: string, personId: string | null = null): Promise<string> {
  const id = uuidv7();
  await db.user.create({
    data: {
      id,
      email,
      displayName: email,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      locale: 'ru',
      personId,
    },
  });
  return id;
}

async function club(db: PrismaClient, name: string): Promise<string> {
  const id = uuidv7();
  await db.organization.create({
    data: { id, type: 'CLUB', name, shortName: name, slug: `club-${id.slice(-12)}`, countryCode: 'RU', status: 'ACTIVE' },
  });
  return id;
}

async function member(db: PrismaClient, organizationId: string, userId: string, validTo?: Date) {
  const role = await db.role.findUniqueOrThrow({ where: { code: 'COACH' } });
  await db.organizationMembership.create({
    data: { id: uuidv7(), organizationId, userId, roleId: role.id, status: 'ACTIVE', validTo },
  });
}

interface Ctx {
  db: PrismaClient;
  competitionId: string;
  categoryId: string;
}

async function entryOf(c: Ctx, organizationId: string, lastName: string) {
  const personId = await person(c.db, lastName);
  const athleteId = uuidv7();
  await c.db.athleteProfile.create({ data: { id: athleteId, personId, publicId: publicId() } });
  const applicationId = uuidv7();
  await c.db.application.create({
    data: {
      id: applicationId,
      competitionId: c.competitionId,
      organizationId,
      status: 'APPROVED',
      submittedAt: new Date(),
    },
  });
  const entryId = uuidv7();
  await c.db.entry.create({
    data: {
      id: entryId,
      competitionId: c.competitionId,
      applicationId,
      athleteId,
      categoryId: c.categoryId,
      declaredCategoryId: c.categoryId,
      status: 'APPROVED',
      snapLastName: lastName,
      snapFirstName: 'Тест',
      snapBirthDate: new Date('2013-04-01'),
      snapGender: 'MALE',
      publicName: `${lastName} Т.`,
    },
  });
  return { personId, athleteId, entryId };
}

interface Slot {
  matId: string;
  sessionId: string;
  order: number;
  plannedAt: Date;
  status?: 'SCHEDULED' | 'IN_PROGRESS';
}

let matchNo = 10;

async function matchOf(c: Ctx, red: string, blue: string, slot: Slot): Promise<string> {
  const id = uuidv7();
  matchNo += 1;
  await c.db.match.create({
    data: {
      id,
      competitionId: c.competitionId,
      categoryId: c.categoryId,
      publicId: publicId(),
      matchNumber: matchNo,
      roundLabel: 'R1',
      status: slot.status ?? 'SCHEDULED',
      matId: slot.status === 'IN_PROGRESS' ? slot.matId : null,
      startedAt: slot.status === 'IN_PROGRESS' ? new Date() : null,
    },
  });
  for (const [side, entryId] of [
    ['RED', red],
    ['BLUE', blue],
  ] as const)
    await c.db.matchParticipant.create({
      data: { id: uuidv7(), competitionId: c.competitionId, matchId: id, side, entryId },
    });
  await c.db.matchSchedule.create({
    data: {
      id: uuidv7(),
      competitionId: c.competitionId,
      matchId: id,
      sessionId: slot.sessionId,
      matId: slot.matId,
      orderInMat: slot.order,
      plannedAt: slot.plannedAt,
    },
  });
  return id;
}

async function ruleSetVersion(db: PrismaClient): Promise<string> {
  const ruleSetId = uuidv7();
  await db.ruleSet.create({
    data: {
      id: ruleSetId,
      code: `MD_${ruleSetId.slice(-8).toUpperCase()}`,
      disciplineCode: 'SPORT_SAMBO',
      name: 'Правила',
    },
  });
  const id = uuidv7();
  await db.ruleSetVersion.create({
    data: {
      id,
      ruleSetId,
      version: 1,
      schemaVersion: 1,
      parameters: {},
      checksum: 'b'.repeat(64),
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  return id;
}

async function competition(db: PrismaClient, organizerOrganizationId: string): Promise<Ctx> {
  const competitionId = uuidv7();
  const today = new Date(new Date().toISOString().slice(0, 10));
  await db.competition.create({
    data: {
      id: competitionId,
      slug: `c-${competitionId.slice(-12)}`,
      name: 'Кубок ковра',
      organizerOrganizationId,
      timezone: 'Europe/Moscow',
      status: 'IN_PROGRESS',
      ruleSetVersionId: await ruleSetVersion(db),
      startDate: today,
      endDate: today,
      registrationStartsAt: new Date(today.getTime() - 30 * 86_400_000),
      registrationEndsAt: new Date(today.getTime() - 5 * 86_400_000),
      level: 'CLUB',
      disciplineCode: 'SPORT_SAMBO',
    },
  });
  const categoryId = uuidv7();
  await db.competitionCategory.create({
    data: {
      id: categoryId,
      competitionId,
      code: 'M-46',
      nameRu: 'Юноши до 46 кг',
      nameEn: 'Boys up to 46 kg',
      gender: 'MALE',
      agePolicy: 'BY_BIRTH_YEAR',
      weightKind: 'UP_TO',
      weightUpperGrams: 46_000,
    },
  });
  return { db, competitionId, categoryId };
}

/** Люди вокруг спортсменов A и B: представитель, сам спортсмен, тренер-подписчик, не получатели. */
async function people(db: PrismaClient, clubId: string, a: { athleteId: string }, b: { athleteId: string; personId: string }) {
  const motherPerson = await person(db, 'Иванова', '1985-01-01');
  const mother = await user(db, 'mother@family.test', motherPerson);
  await db.guardian.create({
    data: {
      id: uuidv7(),
      athleteId: a.athleteId,
      guardianPersonId: motherPerson,
      relation: 'MOTHER',
      verifiedAt: new Date(),
      verificationBasis: 'DOCUMENT_SHOWN',
    },
  });
  const selfB = await user(db, 'petrov@athlete.test', b.personId);
  const coach = await user(db, 'coach@club.test');
  await member(db, clubId, coach);
  const outsider = await user(db, 'fan@other.test');
  const formerMember = await user(db, 'former@club.test');
  await member(db, clubId, formerMember, new Date(Date.now() - 2 * 86_400_000));
  const follows: [string, string][] = [
    [coach, a.athleteId],
    [coach, b.athleteId],
    [outsider, a.athleteId],
    [formerMember, b.athleteId],
  ];
  for (const [userId, targetId] of follows)
    await db.follow.create({ data: { id: uuidv7(), userId, targetType: 'ATHLETE', targetId } });
  return { mother, selfB, coach, outsider, formerMember };
}

export async function matchDayWorld(db: PrismaClient): Promise<MatchDayWorld> {
  const clubId = await club(db, 'СК «Буревестник»');
  const otherClub = await club(db, 'СК «Витязь»');
  const c = await competition(db, clubId);
  const a = await entryOf(c, clubId, 'Иванов');
  const b = await entryOf(c, clubId, 'Петров');
  const f1 = await entryOf(c, otherClub, 'Сидоров');
  const f2 = await entryOf(c, otherClub, 'Кузнецов');
  const [mat1, mat2] = [uuidv7(), uuidv7()];
  for (const [id, number] of [
    [mat1, 1],
    [mat2, 2],
  ] as const)
    await db.mat.create({ data: { id, competitionId: c.competitionId, number } });
  const sessionId = uuidv7();
  const now = Date.now();
  await db.session.create({
    data: {
      id: sessionId,
      competitionId: c.competitionId,
      name: 'Утро',
      startsAt: new Date(now - 60 * MIN),
      endsAt: new Date(now + 5 * 60 * MIN),
    },
  });
  const at = (order: number, minutes: number, status?: Slot['status']): Slot => ({
    matId: mat1,
    sessionId,
    order,
    plannedAt: new Date(now + minutes * MIN),
    status,
  });
  const running = await matchOf(c, f1.entryId, f2.entryId, at(1, -3, 'IN_PROGRESS'));
  const q1 = await matchOf(c, f1.entryId, f2.entryId, at(2, 3));
  const q2 = await matchOf(c, f1.entryId, f2.entryId, at(3, 6));
  const ab = await matchOf(c, a.entryId, b.entryId, at(4, 9));
  const late = await matchOf(c, b.entryId, f1.entryId, at(5, 180));
  return {
    competitionId: c.competitionId,
    categoryId: c.categoryId,
    clubId,
    mat1,
    mat2,
    sessionId,
    athleteA: a.athleteId,
    athleteB: b.athleteId,
    entryA: a.entryId,
    entryB: b.entryId,
    ...(await people(db, clubId, a, b)),
    running,
    q1,
    q2,
    ab,
    late,
  };
}

/** Схватка закончилась (очередь ковра сдвинулась). */
export async function finish(db: PrismaClient, matchId: string): Promise<void> {
  await db.match.update({ where: { id: matchId }, data: { status: 'FINISHED', finishedAt: new Date() } });
}

/** Сессия входа (семейство refresh-токенов): живая или завершённая выходом. */
export async function loginSession(db: PrismaClient, userId: string, revoked = false): Promise<string> {
  const familyId = uuidv7();
  await db.refreshToken.create({
    data: {
      id: uuidv7(),
      userId,
      familyId,
      tokenHash: randomBytes(32),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      revokedAt: revoked ? new Date() : null,
    },
  });
  return familyId;
}

/** Тестовое устройство: ключи подписки браузера, расшифровка сообщения и проверка подписи отправителя. */
export class TestPushDevice {
  private readonly ecdh = createECDH('prime256v1');
  private readonly publicKey: Buffer;
  private readonly authSecret = randomBytes(16);

  constructor(readonly endpoint: string) {
    this.publicKey = this.ecdh.generateKeys();
  }

  get keys(): { p256dh: string; auth: string } {
    return { p256dh: this.publicKey.toString('base64url'), auth: this.authSecret.toString('base64url') };
  }

  async subscribe(db: PrismaClient, userId: string, sessionId: string): Promise<string> {
    const id = uuidv7();
    await db.pushSubscription.create({
      data: { id, userId, sessionId, endpoint: this.endpoint, ...this.keys },
    });
    return id;
  }

  /** RFC 8291 (aes128gcm): заголовок salt|rs|idlen|keyid, ключ и nonce — HKDF от общего секрета ECDH. */
  decrypt(body: Buffer): string {
    const salt = body.subarray(0, 16);
    const rs = body.readUInt32BE(16);
    const idlen = body[20] ?? 0;
    const senderKey = body.subarray(21, 21 + idlen);
    const record = body.subarray(21 + idlen);
    if (record.length > rs) throw new Error('more than one record');
    const secret = this.ecdh.computeSecret(senderKey);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), this.publicKey, senderKey]);
    const ikm = Buffer.from(hkdfSync('sha256', secret, this.authSecret, keyInfo, 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(record.subarray(-16));
    const plain = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
    let end = plain.length - 1;
    while (end >= 0 && plain[end] === 0) end -= 1;
    if (plain[end] !== 2) throw new Error('last record must end with the 0x02 delimiter');
    return plain.subarray(0, end).toString('utf8');
  }
}

/** Заголовок `Authorization: vapid t=<JWT>, k=<ключ>`: подпись ES256 ключом k и утверждения JWT. */
export function verifyVapid(authorization: string, expectedKey: string): Record<string, unknown> {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
  if (!m) throw new Error(`not a VAPID header: ${authorization}`);
  const [, jwt = '', k = ''] = m;
  if (k !== expectedKey) throw new Error('VAPID key differs');
  const point = Buffer.from(k, 'base64url');
  const key = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  const [header = '', claims = '', signature = ''] = jwt.split('.');
  const ok = verifySignature(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
  if (!ok) throw new Error('VAPID signature is invalid');
  return JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as Record<string, unknown>;
}
