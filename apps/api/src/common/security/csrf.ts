// CSRF для cookie-сессии: signed double submit (API.md, 1.6; SECURITY.md, 3.5).
// Cookie `sde_csrf` = random.hmac(random); небезопасный запрос обязан прислать то же значение в X-CSRF-Token.
// Bearer-клиенты (заголовок Authorization или X-Auth-Mode: bearer) cookie не используют и проверку не проходят:
// нестандартный заголовок из чужого сайта без CORS-разрешения не отправить.
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AUTH_MODE_HEADER, COOKIE_CSRF, CSRF_HEADER } from '@sde/contracts';
import { deriveKey, type Env, hmacSha256, KEY_PURPOSES, randomToken, safeEqual } from '@sde/server-kit';
import type { Request } from 'express';
import { ENV } from '../../config/config.module';
import { DomainError } from '../errors/domain-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = deriveKey(env.AUTH_SECRET, KEY_PURPOSES.csrf);
  }

  issue(): string {
    const nonce = randomToken(24);
    return `${nonce}.${hmacSha256(this.key, nonce).toString('base64url')}`;
  }

  isValid(value: string | undefined): boolean {
    if (!value) return false;
    const [nonce, sig] = value.split('.');
    if (!nonce || !sig) return false;
    return safeEqual(hmacSha256(this.key, nonce).toString('base64url'), sig);
  }
}

export function isBearerRequest(req: Request): boolean {
  return Boolean(req.header('authorization')) || req.header(AUTH_MODE_HEADER)?.toLowerCase() === 'bearer';
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method) || isBearerRequest(req)) return true;
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const cookie = cookies?.[COOKIE_CSRF];
    const header = req.header(CSRF_HEADER);
    if (!cookie || !header || !safeEqual(cookie, header) || !this.csrf.isValid(cookie)) {
      throw new DomainError('CSRF_TOKEN_INVALID');
    }
    return true;
  }
}
