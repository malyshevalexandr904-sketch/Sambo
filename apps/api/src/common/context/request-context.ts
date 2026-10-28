// Контекст запроса: traceId, IP, User-Agent, локаль, пользователь (ARCHITECTURE.md, 5).
import { AsyncLocalStorage } from 'node:async_hooks';
import type { CabinetRole, Locale } from '@sde/contracts';

export interface AuthUser {
  id: string;
  sessionId: string;
  permissionsVersion: number;
  totpEnabled: boolean;
  personId: string | null;
  email: string | null;
  emailVerified: boolean;
  /** Как пришла аутентификация: cookie (веб) или Bearer (мини-приложения, мобильное приложение). */
  via: 'cookie' | 'bearer';
  /**
   * Выбранная роль кабинета этой сессии (0.13.0): права и связи действуют только для неё. null — ролей нет:
   * доступно только то, что не требует роли (свой профиль, уведомления, заявка на роль, публичные турниры).
   */
  activeRole: CabinetRole | null;
  /** Демо-вход (правки 27.10.2026): только просмотр — изменения отклоняет DemoReadOnlyGuard. */
  demo?: boolean;
}

export interface RequestContext {
  traceId: string;
  ip: string | null;
  userAgent: string | null;
  locale: Locale;
  user: AuthUser | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Контекст для кода вне HTTP (worker-подобные задачи в api, тесты). */
  current(): RequestContext {
    return storage.getStore() ?? { traceId: 'system', ip: null, userAgent: null, locale: 'ru', user: null };
  },
};
