// Одноразовые токены: подтверждение email, сброс пароля, приглашения. В БД — только SHA-256.
import { Injectable } from '@nestjs/common';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import { randomToken, sha256 } from '@sde/server-kit';
import { DomainError } from '../../../common/errors/domain-error';

export type TokenPurpose = 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'INVITE' | 'MESSENGER_LINK';

export interface ConsumedToken {
  id: string;
  userId: string | null;
  payload: Prisma.JsonValue | null;
}

@Injectable()
export class VerificationTokenService {
  async issue(
    tx: Tx,
    purpose: TokenPurpose,
    opts: { userId: string | null; ttlSeconds: number; payload?: Prisma.InputJsonValue },
  ): Promise<string> {
    const raw = randomToken(32);
    await tx.verificationToken.create({
      data: {
        id: uuidv7(),
        userId: opts.userId,
        purpose,
        tokenHash: sha256(raw),
        payload: opts.payload,
        expiresAt: new Date(Date.now() + opts.ttlSeconds * 1000),
      },
    });
    return raw;
  }

  /** Погашает токен. Неверный, использованный и просроченный токен неразличимы: TOKEN_EXPIRED. */
  async consume(tx: Tx, purpose: TokenPurpose, raw: string): Promise<ConsumedToken> {
    const hash = sha256(raw);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM verification_token
      WHERE token_hash = ${hash} AND purpose = ${purpose}::"TokenPurpose"
        AND consumed_at IS NULL AND expires_at > now()
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new DomainError('TOKEN_EXPIRED');
    const token = await tx.verificationToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
      select: { id: true, userId: true, payload: true },
    });
    return token;
  }

  /** Гасит все действующие токены цели пользователя (например, старые ссылки сброса пароля). */
  async invalidateAll(tx: Tx, userId: string, purpose: TokenPurpose): Promise<void> {
    await tx.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}
