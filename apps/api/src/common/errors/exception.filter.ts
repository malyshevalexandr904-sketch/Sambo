// Единый формат ошибок (API.md, 1.8). Неизвестная ошибка → INTERNAL_ERROR, детали — только в лог.
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@sde/db';
import { type ApiErrorBody, type ErrorCode, categoryOf, httpStatusOf } from '@sde/contracts';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { RequestContextStore } from '../context/request-context';
import { DomainError } from './domain-error';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Request validation failed.',
  UNAUTHENTICATED: 'Authentication required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'Resource not found.',
  INTERNAL_ERROR: 'Internal server error.',
  RATE_LIMITED: 'Too many requests.',
};

/** Имена unique-ограничений → коды конфликтов (ARCHITECTURE.md, 9). */
const UNIQUE_CONSTRAINT_CODES: Record<string, ErrorCode> = {
  organization_slug_key: 'SLUG_TAKEN',
  slug: 'SLUG_TAKEN',
};

export function toDomainError(exception: unknown): DomainError | null {
  if (exception instanceof DomainError) return exception;
  if (exception instanceof ZodError) {
    return new DomainError('VALIDATION_FAILED', {
      fields: exception.issues.map((i) => ({ path: i.path.join('.'), code: i.message })),
    });
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      const target = exception.meta?.target;
      const names = Array.isArray(target)
        ? target.map((x) => String(x))
        : [typeof target === 'string' ? target : ''];
      const mapped = names.map((n) => UNIQUE_CONSTRAINT_CODES[n]).find(Boolean);
      return new DomainError(mapped ?? 'ALREADY_EXISTS');
    }
    if (exception.code === 'P2025') return new DomainError('NOT_FOUND');
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === 404) return new DomainError('NOT_FOUND', { resource: 'route' });
    if (status === 413)
      return new DomainError('VALIDATION_FAILED', { fields: [{ path: '', code: 'payload_too_large' }] });
    if (status === 400)
      return new DomainError('VALIDATION_FAILED', { fields: [{ path: '', code: 'malformed_request' }] });
    if (status === 401) return new DomainError('UNAUTHENTICATED');
    if (status === 403) return new DomainError('FORBIDDEN');
  }
  return null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { traceId?: string }>();
    const traceId = req.traceId ?? RequestContextStore.current().traceId;
    const domain = toDomainError(exception);

    const code: ErrorCode = domain?.code ?? 'INTERNAL_ERROR';
    const status = httpStatusOf(code);
    if (!domain || status >= 500) {
      this.logger.error(
        {
          err: exception,
          traceId,
          route: (req.route as { path?: string } | undefined)?.path,
          errorCode: code,
        },
        'Unhandled error',
      );
    }
    if (code === 'RATE_LIMITED' && typeof domain?.details?.retryAfterSeconds === 'number') {
      res.setHeader('Retry-After', String(domain.details.retryAfterSeconds));
    }
    const body: ApiErrorBody = {
      error: {
        code,
        category: categoryOf(code),
        message: domain?.message && domain.message !== code ? domain.message : (MESSAGES[code] ?? code),
        ...(domain?.details && status < 500 ? { details: domain.details } : {}),
        traceId,
      },
    };
    res.status(status).json(body);
  }
}
