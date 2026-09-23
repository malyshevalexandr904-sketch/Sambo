// TOTP для платформенных ролей (ARCHITECTURE.md, 6): секрет зашифрован, коды восстановления — хеши.
import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_ROLE_CODES } from '@sde/contracts';
import type { Tx } from '@sde/db';
import {
  type Env,
  generateRecoveryCodes,
  hashRecoveryCode,
  openTotpSecret,
  sealTotpSecret,
  totpKey,
} from '@sde/server-kit';
import { authenticator } from 'otplib';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.module';
import { AuditService } from '../../audit';

const ISSUER = 'SAMBO Digital';
authenticator.options = { window: 1, step: 30, digits: 6 };

interface TotpUser {
  id: string;
  email: string | null;
  totpSecretEnc: Uint8Array | null;
  totpEnabledAt: Date | null;
  totpRecoveryCodeHashes: string[];
}

@Injectable()
export class TotpService {
  private readonly key: Buffer;

  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.key = totpKey(env.TOTP_ENCRYPTION_KEY);
  }

  async setup(userId: string): Promise<{ otpauthUri: string }> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new DomainError('ALREADY_EXISTS', { resource: 'totp' });
    const secret = authenticator.generateSecret(20);
    await this.db.user.update({ where: { id: userId }, data: { totpSecretEnc: sealTotpSecret(this.key, userId, secret) } });
    return { otpauthUri: authenticator.keyuri(user.email ?? user.displayName, ISSUER, secret) };
  }

  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    return this.db.tx(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.totpEnabledAt) throw new DomainError('ALREADY_EXISTS', { resource: 'totp' });
      if (!user.totpSecretEnc || !(await this.checkCode(user, code))) throw new DomainError('TOTP_INVALID');
      const { codes, hashes } = generateRecoveryCodes();
      await tx.user.update({
        where: { id: userId },
        data: { totpEnabledAt: new Date(), totpRecoveryCodeHashes: hashes, permissionsVersion: { increment: 1 } },
      });
      await this.audit.record(tx, { action: 'auth.totp_enabled', entityType: 'User', entityId: userId });
      return { recoveryCodes: codes };
    });
  }

  async disable(userId: string, code: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const platformRoles = await tx.platformRoleAssignment.count({
        where: { userId, revokedAt: null, role: { code: { in: [...PLATFORM_ROLE_CODES] } } },
      });
      if (platformRoles > 0) throw new DomainError('FORBIDDEN', { reason: 'totp_required_for_platform_roles' });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.totpEnabledAt || !(await this.verify(tx, user, code))) throw new DomainError('TOTP_INVALID');
      await tx.user.update({
        where: { id: userId },
        data: { totpEnabledAt: null, totpSecretEnc: null, totpRecoveryCodeHashes: [], permissionsVersion: { increment: 1 } },
      });
      await this.audit.record(tx, { action: 'auth.totp_disabled', entityType: 'User', entityId: userId });
    });
  }

  /**
   * Проверка второго фактора при входе: код TOTP (без повторного использования одного интервала)
   * или одноразовый код восстановления (гасится).
   */
  async verify(tx: Tx, user: TotpUser, code: string): Promise<boolean> {
    if (/^\d{6}$/.test(code)) return this.checkCode(user, code);
    const hash = hashRecoveryCode(code);
    if (!user.totpRecoveryCodeHashes.includes(hash)) return false;
    await tx.user.update({
      where: { id: user.id },
      data: { totpRecoveryCodeHashes: user.totpRecoveryCodeHashes.filter((h) => h !== hash) },
    });
    return true;
  }

  private async checkCode(user: TotpUser, code: string): Promise<boolean> {
    if (!user.totpSecretEnc) return false;
    const secret = openTotpSecret(this.key, user.id, user.totpSecretEnc);
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return false;
    // Защита от повтора: один и тот же интервал принимается один раз.
    const step = Math.floor(Date.now() / 1000 / 30) + delta;
    try {
      const fresh = await this.redis.set(`totp-used:${user.id}:${step}`, '1', 'EX', 120, 'NX');
      return fresh === 'OK';
    } catch {
      return true;
    }
  }
}
