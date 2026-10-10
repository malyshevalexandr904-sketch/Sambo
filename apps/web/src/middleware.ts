// Локаль + Content-Security-Policy с nonce (SECURITY.md, 6). Next.js берёт nonce из заголовка запроса
// и проставляет его своим скриптам; инлайн-скрипты без nonce браузер не выполнит.
import createIntlMiddleware from 'next-intl/middleware';
import type { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intl = createIntlMiddleware(routing);

/**
 * WebSocket своего origin (живые данные, Phase 8a). CSP 3 считает ws/wss того же хоста за 'self', но старые
 * браузеры (Safari до 15.4 — старые планшеты) — нет: адрес указывается явно.
 */
function liveOrigin(request: NextRequest, dev: boolean): string {
  const host = request.headers.get('host');
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) return '';
  const secure =
    request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:';
  return secure ? ` wss://${host}` : dev ? ` ws://${host}` : ` wss://${host} ws://${host}`;
}

function csp(nonce: string, dev: boolean, storage: string | undefined, live: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Атрибуты style (объявления маршрутов Next.js, библиотеки) nonce не покрывает.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${storage ? ` ${storage}` : ''}`,
    "font-src 'self'",
    // Загрузка файлов идёт напрямую в хранилище по presigned POST (ADR-14).
    `connect-src 'self'${live}${storage ? ` ${storage}` : ''}${dev ? ' ws:' : ''}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

export default function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const policy = csp(nonce, dev, process.env.STORAGE_UPLOAD_ORIGIN, liveOrigin(request, dev));
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', policy);
  const response = intl(request);
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Всё, кроме API, живых данных (/ws — Socket.IO), служебных путей Next.js и файлов со статикой.
  matcher: ['/((?!api|ws|_next|_vercel|health|.*\\..*).*)'],
};
