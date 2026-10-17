// Публичный интерфейс модуля access.
export { AccessModule } from './access.module';
export { PolicyService, type RelationshipPolicy } from './application/policy.service';
export { GrantsService } from './application/grants.service';
export {
  CabinetRolesService,
  type CabinetRoleHolder,
  type CabinetUser,
  type SessionRoleRow,
} from './application/cabinet-roles.service';
export {
  asResolution,
  ScopeResolverRegistry,
  type ScopeResolution,
  type ScopeResolverFn,
} from './application/scope-resolvers';
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
  grantsForRole,
  holdsAnywhere,
  missingPermissionsForRole,
  NOWHERE_SCOPE,
  organizationReach,
  type OrganizationReach,
  permissionsInScope,
  type EffectiveGrants,
  type ResourceScope,
} from './domain/grants';
