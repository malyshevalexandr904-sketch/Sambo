// Объявление доступа к маршруту (ARCHITECTURE.md, 5; PERMISSIONS.md, 7).
// Каждый маршрут обязан иметь ровно одно объявление — это проверяет автотест маршрутов.
import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@sde/contracts';

export const ROUTE_ACCESS = 'sde:route-access';

/** Ссылка на способ вычислить область ресурса. Резолверы регистрируют модули-владельцы данных. */
export interface ScopeRef {
  resolver: string;
  /** Имя параметра пути с идентификатором ресурса. */
  param?: string;
}

export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permission'; permission: PermissionCode; scope: ScopeRef };

/** Открытый маршрут. Аутентификация, если есть, всё равно разбирается. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ROUTE_ACCESS, { kind: 'public' } satisfies RouteAccess);

/** Любой вошедший пользователь; дальнейшие проверки — в use case (политики «своё»). */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ROUTE_ACCESS, { kind: 'authenticated' } satisfies RouteAccess);

/**
 * Право в области ресурса. Область выводится на сервере из ресурса, загруженного по параметру пути,
 * а не из тела запроса (PERMISSIONS.md, 6).
 */
export const RequirePermission = (permission: PermissionCode, scope: ScopeRef): MethodDecorator =>
  applyDecorators(SetMetadata(ROUTE_ACCESS, { kind: 'permission', permission, scope } satisfies RouteAccess));

export const PLATFORM_SCOPE: ScopeRef = { resolver: 'platform' };
