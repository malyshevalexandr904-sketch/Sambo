import { Global, Module } from '@nestjs/common';
import { CabinetRolesService } from './application/cabinet-roles.service';
import { GrantsService } from './application/grants.service';
import { PolicyService } from './application/policy.service';
import { ScopeResolverRegistry } from './application/scope-resolvers';
import { PermissionGuard } from './api/permission.guard';

@Global()
@Module({
  providers: [GrantsService, PolicyService, ScopeResolverRegistry, PermissionGuard, CabinetRolesService],
  exports: [GrantsService, PolicyService, ScopeResolverRegistry, PermissionGuard, CabinetRolesService],
})
export class AccessModule {}
