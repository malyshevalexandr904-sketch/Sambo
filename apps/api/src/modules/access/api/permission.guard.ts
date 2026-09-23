// Последний guard конвейера (ARCHITECTURE.md, 5): требует вход и проверяет право в области ресурса.
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextStore } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PolicyService } from '../application/policy.service';
import { ScopeResolverRegistry } from '../application/scope-resolvers';
import type { ResourceScope } from '../domain/grants';
import { ROUTE_ACCESS, type RouteAccess } from './decorators';

export interface AccessAwareRequest extends Request {
  accessScope?: ResourceScope;
  accessViaPlatform?: boolean;
  authError?: DomainError;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: PolicyService,
    private readonly scopes: ScopeResolverRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Deny by default: маршрут без объявления доступа не работает (SECURITY.md, 1.4).
    if (!access) throw new DomainError('FORBIDDEN', { reason: 'route_access_not_declared' });
    if (access.kind === 'public') return true;

    const req = context.switchToHttp().getRequest<AccessAwareRequest>();
    const user = RequestContextStore.current().user;
    if (!user) throw req.authError ?? new DomainError('UNAUTHENTICATED');
    if (access.kind === 'authenticated') return true;

    const param = access.scope.param ? req.params[access.scope.param] : undefined;
    const id = typeof param === 'string' ? param : undefined;
    const scope = await this.scopes.get(access.scope.resolver)(id, req);
    const result = await this.policy.assert(user, access.permission, scope);
    req.accessScope = scope;
    req.accessViaPlatform = result.viaPlatform;
    return true;
  }
}
