// Локаль + Content-Security-Policy с nonce (SECURITY.md, 6). Next.js берёт nonce из заголовка запроса
// и проставляет его своим скриптам; инлайн-скрипты без nonce браузер не выполнит.
import createIntlMiddleware from 'next-intl/middleware';
import type { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intl = createIntlMiddleware(routing);

function csp(nonce: string, dev: boolean, storage: string | undefined): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Атрибуты style (объявления маршрутов Next.js, библиотеки) nonce не покрывает.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${storage ? ` ${storage}` : ''}`,
    "font-src 'self'",
    // Загрузка файлов идёт напрямую в хранилище по presigned POST (ADR-14).
    `connect-src 'self'${storage ? ` ${storage}` : ''}${dev ? ' ws:' : ''}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

export default function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = csp(nonce, process.env.NODE_ENV !== 'production', process.env.STORAGE_UPLOAD_ORIGIN);
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', policy);
  const response = intl(request);
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Всё, кроме API, служебных путей Next.js и файлов со статикой.
  matcher: ['/((?!api|_next|_vercel|health|.*\\..*).*)'],
};
