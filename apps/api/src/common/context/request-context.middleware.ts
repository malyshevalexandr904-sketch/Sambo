import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextStore } from './request-context';

export const TRACE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Выставляет traceId (из X-Request-Id прокси или новый), IP, User-Agent, локаль. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // pino-http уже назначил req.id (genReqId в AppModule): лог и ответ используют один traceId.
    const assigned = (req as Request & { id?: unknown }).id;
    const incoming = req.header('x-request-id');
    const traceId =
      typeof assigned === 'string' && TRACE_ID_RE.test(assigned)
        ? assigned
        : incoming && TRACE_ID_RE.test(incoming)
          ? incoming
          : randomUUID();
    res.setHeader('X-Request-Id', traceId);
    const acceptLanguage = req.header('accept-language') ?? '';
    const locale = acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'ru';
    const userAgent = req.header('user-agent')?.slice(0, 500) ?? null;
    (req as Request & { traceId?: string }).traceId = traceId;
    RequestContextStore.run({ traceId, ip: req.ip ?? null, userAgent, locale, user: null }, () => next());
  }
}
