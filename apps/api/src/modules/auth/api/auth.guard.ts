// Первый guard конвейера: определяет пользователя по cookie или Bearer. Не отклоняет запрос сам —
// решение принимает PermissionGuard (публичный маршрут доступен и с просроченным токеном).
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { COOKIE_ACCESS } from '@sde/contracts';
import type { Request } from 'express';
import { RequestContextStore } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import type { AccessAwareRequest } from '../../access';
import { AccessTokenAuthenticator } from '../application/access-token.authenticator';

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
  constructor(private readonly authenticator: AccessTokenAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AccessAwareRequest>();
    const ctx = RequestContextStore.current();
    const extracted = extractToken(req);
    if (!extracted) return true;
    try {
      const { user, locale } = await this.authenticator.authenticate(extracted.token, extracted.via);
      ctx.user = user;
      if (!req.header('accept-language')) ctx.locale = locale;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      req.authError = e;
    }
    return true;
  }
}
