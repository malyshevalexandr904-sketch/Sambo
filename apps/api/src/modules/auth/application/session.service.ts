// Сессии: семейства refresh token, ротация, отзыв, blocklist access token (ARCHITECTURE.md, 6).
import { Injectable, Logger } from '@nestjs/common';
import { maskIp, type SessionDto } from '@sde/contracts';
import { type Tx, uuidv7 } from '@sde/db';
import { randomToken, sha256 } from '@sde/server-kit';
import { RequestContextStore } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.module';
import { AuditService } from '../../audit';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  classifyRefresh,
  nextRefreshExpiry,
  sessionExhausted,
} from '../domain/session-policy';
import { JwtService } from '../infrastructure/jwt.service';

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const blockKey = (sid: string): string => `revoked-sid:${sid}`;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Новая сессия (семейство) после входа или подтверждения email. */
  async create(tx: Tx, user: { id: string; permissionsVersion: number }): Promise<IssuedSession> {
    const now = new Date();
    const sessionId = uuidv7();
    return this.issue(tx, user, sessionId, nextRefreshExpiry(now, now), null);
  }

  private async issue(
    tx: Tx,
    user: { id: string; permissionsVersion: number },
    sessionId: string,
    refreshExpiresAt: Date,
    replaces: string | null,
  ): Promise<IssuedSession> {
    const ctx = RequestContextStore.current();
    const refreshToken = randomToken(32);
    const id = uuidv7();
    await tx.refreshToken.create({
      data: {
        id,
        userId: user.id,
        familyId: sessionId,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    if (replaces) await tx.refreshToken.update({ where: { id: replaces }, data: { replacedById: id } });
    const access = await this.jwt.sign({ sub: user.id, sid: sessionId, pv: user.permissionsVersion });
    return {
      sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  }

  /** Ротация refresh token. Повторное предъявление отзывает всю сессию (REFRESH_TOKEN_REUSED). */
  async rotate(rawRefreshToken: string): Promise<IssuedSession> {
    type Outcome =
      | { kind: 'ok'; session: IssuedSession }
      | { kind: 'revoked'; error: 'REFRESH_TOKEN_REUSED' | 'ACCOUNT_BLOCKED'; familyId: string };
    const outcome = await this.db.tx(async (tx): Promise<Outcome> => {
      const hash = sha256(rawRefreshToken);
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM refresh_token WHERE token_hash = ${hash} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new DomainError('REFRESH_TOKEN_INVALID');
      const token = await tx.refreshToken.findUniqueOrThrow({
        where: { id: row.id },
        include: { user: { select: { id: true, status: true, permissionsVersion: true } } },
      });
      const now = new Date();
      const verdict = classifyRefresh(token, now);
      if (verdict === 'REUSED') {
        await this.revokeFamilyTx(tx, token.familyId, 'reuse_detected');
        await this.audit.record(tx, {
          action: 'auth.refresh_reuse_detected',
          entityType: 'User',
          entityId: token.userId,
          actorUserId: token.userId,
        });
        return { kind: 'revoked', error: 'REFRESH_TOKEN_REUSED', familyId: token.familyId };
      }
      if (verdict === 'EXPIRED') throw new DomainError('REFRESH_TOKEN_INVALID');
      if (token.user.status !== 'ACTIVE') {
        await this.revokeFamilyTx(tx, token.familyId, 'account_inactive');
        return { kind: 'revoked', error: 'ACCOUNT_BLOCKED', familyId: token.familyId };
      }
      const first = await tx.refreshToken.findFirst({
        where: { familyId: token.familyId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const startedAt = first?.createdAt ?? token.createdAt;
      if (sessionExhausted(now, startedAt)) throw new DomainError('REFRESH_TOKEN_INVALID');
      const session = await this.issue(
        tx,
        token.user,
        token.familyId,
        nextRefreshExpiry(now, startedAt),
        token.id,
      );
      return { kind: 'ok', session };
    });
    if (outcome.kind === 'revoked') {
      // Отзыв зафиксирован транзакцией; blocklist access token — после commit.
      await this.blockSessions([outcome.familyId]);
      throw new DomainError(outcome.error);
    }
    return outcome.session;
  }

  private async revokeFamilyTx(tx: Tx, familyId: string, reason: string): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  /** Отзыв одной сессии. Вызывающий обязан проверить, что сессия принадлежит пользователю. */
  async revoke(tx: Tx, familyId: string, reason: string): Promise<void> {
    await this.revokeFamilyTx(tx, familyId, reason);
  }

  /** Отзыв всех сессий пользователя (кроме `exceptSessionId`). Возвращает отозванные семейства. */
  async revokeAll(tx: Tx, userId: string, reason: string, exceptSessionId?: string): Promise<string[]> {
    const families = await tx.refreshToken.findMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { familyId: { not: exceptSessionId } } : {}) },
      distinct: ['familyId'],
      select: { familyId: true },
    });
    const ids = families.map((f) => f.familyId);
    if (ids.length > 0) {
      await tx.refreshToken.updateMany({
        where: { familyId: { in: ids }, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: reason },
      });
    }
    return ids;
  }

  /** Blocklist access token отозванных сессий до истечения их срока. */
  async blockSessions(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    try {
      const multi = this.redis.multi();
      for (const sid of sessionIds) multi.set(blockKey(sid), '1', 'EX', ACCESS_TOKEN_TTL_SECONDS + 60);
      await multi.exec();
    } catch (e) {
      // Резерв — проверка сессии по БД в AuthGuard, пока Redis недоступен.
      this.logger.warn({ err: e }, 'Failed to write session blocklist');
    }
  }

  /** Сессия активна: не в blocklist (Redis) и не отозвана (БД — резерв при недоступности Redis). */
  async isActive(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(blockKey(sessionId))) === 0;
    } catch {
      const alive = await this.db.refreshToken.findFirst({
        where: { familyId: sessionId, revokedAt: null },
        select: { id: true },
      });
      return alive !== null;
    }
  }

  async list(userId: string, currentSessionId: string): Promise<SessionDto[]> {
    const tokens = await this.db.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, createdAt: true, ip: true, userAgent: true, replacedById: true },
    });
    const live = tokens.filter((t) => t.replacedById === null);
    const starts = await this.db.refreshToken.groupBy({
      by: ['familyId'],
      where: { familyId: { in: live.map((t) => t.familyId) } },
      _min: { createdAt: true },
    });
    const startOf = new Map(starts.map((s) => [s.familyId, s._min.createdAt]));
    return live.map((t) => ({
      id: t.familyId,
      current: t.familyId === currentSessionId,
      userAgent: t.userAgent,
      ipMasked: maskIp(t.ip),
      createdAt: (startOf.get(t.familyId) ?? t.createdAt).toISOString(),
      lastUsedAt: t.createdAt.toISOString(),
    }));
  }

  async belongsTo(sessionId: string, userId: string): Promise<boolean> {
    const t = await this.db.refreshToken.findFirst({
      where: { familyId: sessionId, userId },
      select: { id: true },
    });
    return t !== null;
  }
}
