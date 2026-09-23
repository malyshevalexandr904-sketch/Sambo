// Общие HTTP-соглашения: конверт, курсоры, If-Match (API.md, 1.3–1.4).
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { DataEnvelope, Page } from '@sde/contracts';
import type { Request } from 'express';
import { DomainError } from '../errors/domain-error';

export const ok = <T>(data: T): DataEnvelope<T> => ({ data });

export interface CursorKey {
  /** Значение ключа сортировки (строка ISO для дат). */
  k: string;
  id: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as CursorKey).k === 'string' &&
      typeof (parsed as CursorKey).id === 'string'
    ) {
      return parsed as CursorKey;
    }
  } catch {
    // Ниже — единая ошибка для любого повреждённого курсора.
  }
  throw new DomainError('INVALID_CURSOR');
}

/**
 * Страница из выборки `limit + 1` строк: лишняя строка означает, что есть продолжение.
 */
export function toPage<Row, Dto>(
  rows: Row[],
  limit: number,
  key: (row: Row) => CursorKey,
  map: (row: Row) => Dto,
): Page<Dto> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    data: pageRows.map(map),
    page: { nextCursor: hasMore && last ? encodeCursor(key(last)) : null, hasMore },
  };
}

/** Версия из `If-Match: "v{version}"`. Обязательна для PATCH и переходов версионируемых ресурсов. */
export function parseIfMatch(header: string | undefined): number {
  if (!header) throw new DomainError('VERSION_REQUIRED');
  const match = /^(?:W\/)?"v(\d{1,9})"$/.exec(header.trim());
  if (!match?.[1])
    throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'If-Match', code: 'invalid_etag' }] });
  return Number(match[1]);
}

export const IfMatchVersion = createParamDecorator((_: unknown, ctx: ExecutionContext): number => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return parseIfMatch(req.header('if-match'));
});

export const etag = (version: number): string => `"v${version}"`;
