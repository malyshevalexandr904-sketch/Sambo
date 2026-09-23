import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  type AdminUser,
  AdminUsersQuery,
  AssignPlatformRoleRequest,
  type DataEnvelope,
  type Page,
  type PermissionDto,
  ReasonRequest,
  type RoleDto,
} from '@sde/contracts';
import { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidParam, ValidQuery } from '../../../common/validation/zod.pipe';
import { PLATFORM_SCOPE, RequirePermission } from '../../access';
import { AdminUsersService } from '../application/admin-users.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  @RequirePermission('user.view', PLATFORM_SCOPE)
  list(@ValidQuery(AdminUsersQuery) q: AdminUsersQuery): Promise<Page<AdminUser>> {
    return this.users.list(q);
  }

  @Get('users/:id')
  @RequirePermission('user.view', PLATFORM_SCOPE)
  async get(@UuidParam('id') id: string): Promise<DataEnvelope<AdminUser>> {
    return ok(await this.users.get(id));
  }

  @Post('users/:id/block')
  @RequirePermission('user.manage', PLATFORM_SCOPE)
  @HttpCode(200)
  async block(@CurrentUser() actor: AuthUser, @UuidParam('id') id: string, @ValidBody(ReasonRequest) body: ReasonRequest): Promise<DataEnvelope<AdminUser>> {
    return ok(await this.users.block(actor, id, body.reason));
  }

  @Post('users/:id/unblock')
  @RequirePermission('user.manage', PLATFORM_SCOPE)
  @HttpCode(200)
  async unblock(@UuidParam('id') id: string, @ValidBody(ReasonRequest) body: ReasonRequest): Promise<DataEnvelope<AdminUser>> {
    return ok(await this.users.unblock(id, body.reason));
  }

  @Post('users/:id/platform-roles')
  @RequirePermission('role.manage', PLATFORM_SCOPE)
  async assignRole(
    @CurrentUser() actor: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(AssignPlatformRoleRequest) body: AssignPlatformRoleRequest,
  ): Promise<DataEnvelope<AdminUser>> {
    return ok(await this.users.assignPlatformRole(actor, id, body));
  }

  @Delete('users/:id/platform-roles/:roleCode')
  @RequirePermission('role.manage', PLATFORM_SCOPE)
  @HttpCode(204)
  async revokeRole(
    @UuidParam('id') id: string,
    @ValidParam('roleCode', z.string().regex(/^[A-Z_]{2,40}$/)) roleCode: string,
    @ValidBody(ReasonRequest) body: ReasonRequest,
  ): Promise<void> {
    await this.users.revokePlatformRole(id, roleCode, body.reason);
  }

  @Get('roles')
  @RequirePermission('user.view', PLATFORM_SCOPE)
  roles(): DataEnvelope<RoleDto[]> {
    return ok(this.users.roles());
  }

  @Get('permissions')
  @RequirePermission('user.view', PLATFORM_SCOPE)
  permissions(): DataEnvelope<PermissionDto[]> {
    return ok(this.users.permissions());
  }
}
