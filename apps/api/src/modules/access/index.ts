// Публичный интерфейс модуля access.
export { AccessModule } from './access.module';
export { PolicyService, type RelationshipPolicy } from './application/policy.service';
export { GrantsService } from './application/grants.service';
export { ScopeResolverRegistry, type ScopeResolverFn } from './application/scope-resolvers';
export { PermissionGuard, type AccessAwareRequest } from './api/permission.guard';
export {
  Authenticated,
  PLATFORM_SCOPE,
  Public,
  RequirePermission,
  ROUTE_ACCESS,
  type RouteAccess,
  type ScopeRef,
} from './api/decorators';
export {
  canSee,
  decide,
  grantablePermissions,
  missingPermissionsForRole,
  permissionsInScope,
  type EffectiveGrants,
  type ResourceScope,
} from './domain/grants';
