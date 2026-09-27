// Прибытие (ARCHITECTURE.md, 16.4) и QR участника (API.md, 5.5): подписанный токен без ПДн.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CheckInStatus, CompetitionStatus } from '@sde/contracts';

/** Отметки прибытия — с начала мандатной комиссии до окончания соревнований (поздние дни многодневного турнира). */
export const CHECK_IN_PHASE: readonly CompetitionStatus[] = [
  'CHECK_IN',
  'DRAWING',
  'SCHEDULED',
  'IN_PROGRESS',
];

const TRANSITIONS: Record<CheckInStatus, readonly CheckInStatus[]> = {
  EXPECTED: ['ARRIVED', 'NOT_ARRIVED', 'WITHDRAWN'],
  NOT_ARRIVED: ['ARRIVED'],
  ARRIVED: ['WITHDRAWN'],
  WITHDRAWN: [],
};

export const checkInTransitions = (from: CheckInStatus): readonly CheckInStatus[] => TRANSITIONS[from];

export const canCheckIn = (from: CheckInStatus, to: CheckInStatus): boolean => TRANSITIONS[from].includes(to);

const VERSION = 'q1';
const UUID_BYTES = 16;
const SIG_BYTES = 16;

const uuidToBytes = (id: string): Buffer => Buffer.from(id.replace(/-/g, ''), 'hex');

const bytesToUuid = (b: Buffer): string => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const sign = (key: Buffer, payload: Buffer): Buffer =>
  createHmac('sha256', key).update(payload).digest().subarray(0, SIG_BYTES);

export interface QrClaims {
  competitionId: string;
  athleteId: string;
  /** Срок действия, секунды Unix. */
  exp: number;
}

/**
 * `q1.<base64url(competitionId ‖ athleteId ‖ exp)>.<base64url(HMAC-SHA256[0..16])>` — компактно для QR,
 * без ПДн: по токену без подписи ничего не узнать, подделать его нельзя.
 */
export function issueQrToken(key: Buffer, claims: QrClaims): string {
  const exp = Buffer.alloc(4);
  exp.writeUInt32BE(claims.exp);
  const payload = Buffer.concat([uuidToBytes(claims.competitionId), uuidToBytes(claims.athleteId), exp]);
  return `${VERSION}.${payload.toString('base64url')}.${sign(key, payload).toString('base64url')}`;
}

/** Проверка подписи и срока; неверный или просроченный токен — null. */
export function verifyQrToken(key: Buffer, token: string, now: Date): QrClaims | null {
  const [version, body, sig] = token.split('.');
  if (version !== VERSION || !body || !sig) return null;
  const payload = Buffer.from(body, 'base64url');
  const signature = Buffer.from(sig, 'base64url');
  if (payload.length !== UUID_BYTES * 2 + 4 || signature.length !== SIG_BYTES) return null;
  if (!timingSafeEqual(signature, sign(key, payload))) return null;
  const exp = payload.readUInt32BE(UUID_BYTES * 2);
  if (exp * 1000 < now.getTime()) return null;
  return {
    competitionId: bytesToUuid(payload.subarray(0, UUID_BYTES)),
    athleteId: bytesToUuid(payload.subarray(UUID_BYTES, UUID_BYTES * 2)),
    exp,
  };
}

/** Токен действует до конца суток через день после окончания турнира (UTC) — с запасом на часовые пояса. */
export function qrExpiry(endDate: string): number {
  const d = new Date(`${endDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  return Math.floor(d.getTime() / 1000);
}
