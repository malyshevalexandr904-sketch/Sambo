// Первый guard конвейера: определяет пользователя по cookie или Bearer. Не отклоняет запрос сам —
// решение принимает PermissionGuard (публичный маршрут доступен и с просроченным токеном).
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { COOKIE_ACCESS } from '@sde/contracts';
import type { Request } from 'express';
import { RequestContextStore } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AccessAwareRequest } from '../../access';
import { SessionService } from '../application/session.service';
import { JwtService } from '../infrastructure/jwt.service';

function extractToken(req: Request): { token: string; via: 'cookie' | 'bearer' } | null {
  const header = req.header('authorization');
  if (header) {
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? { token: value, via: 'bearer' } : null;
  }
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const cookie = cookies?.[COOKIE_ACCESS];
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AccessAwareRequest>();
    const ctx = RequestContextStore.current();
    const extracted = extractToken(req);
    if (!extracted) return true;
    try {
      const claims = await this.jwt.verify(extracted.token);
      if (!(await this.sessions.isActive(claims.sid))) throw new DomainError('UNAUTHENTICATED');
      const user = await this.db.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, status: true, permissionsVersion: true, totpEnabledAt: true, personId: true, email: true, emailVerifiedAt: true, locale: true },
      });
      if (!user || user.status === 'PENDING_VERIFICATION') throw new DomainError('UNAUTHENTICATED');
      if (user.status === 'BLOCKED') throw new DomainError('ACCOUNT_BLOCKED');
      ctx.user = {
        id: user.id,
        sessionId: claims.sid,
        permissionsVersion: user.permissionsVersion,
        totpEnabled: user.totpEnabledAt !== null,
        personId: user.personId,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        via: extracted.via,
      };
      if (!req.header('accept-language')) ctx.locale = user.locale === 'en' ? 'en' : 'ru';
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      req.authError = e;
    }
    return true;
  }
}
