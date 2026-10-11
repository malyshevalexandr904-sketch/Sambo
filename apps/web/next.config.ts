import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { SECURITY_HEADERS } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  // Монорепозиторий: трассировка зависимостей от корня, чтобы standalone-сборка включила packages/*.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  reactStrictMode: true,
  poweredByHeader: false,
  // ESLint запускается отдельно в CI (pnpm lint) с общей конфигурацией монорепозитория.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@sde/ui', '@sde/contracts'],
  // Браузер обращается к API через тот же origin: cookie сессии и CSRF работают без CORS (API.md, 1.6).
  // Живые данные (Phase 8a): Socket.IO на пути /ws — Next.js проксирует и long polling, и WebSocket (upgrade).
  // На сервере /ws уходит в api напрямую через Caddy (deploy/server/Caddyfile), сюда не доходит.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/ws', destination: `${apiUrl}/ws` },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default withNextIntl(config);
