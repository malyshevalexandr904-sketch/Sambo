// PolicyService (ARCHITECTURE.md, 8): решение о доступе, политики отношений, allowedActions.
import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import {
  canSee,
  decide,
  type EffectiveGrants,
  permissionsInScope,
  type ResourceScope,
} from '../domain/grants';
import { GrantsService } from './grants.service';

/** Политика отношений (◐): «свой спортсмен», «назначен на ковёр» и т. п. Регистрирует модуль-владелец. */
export type RelationshipPolicy = (
  user: AuthUser,
  scope: ResourceScope,
  resource: unknown,
) => Promise<boolean>;

export interface AccessResult {
  viaPlatform: boolean;
  grants: EffectiveGrants;
}

@Injectable()
export class PolicyService {
  private readonly policies = new Map<PermissionCode, RelationshipPolicy>();

  constructor(private readonly grantsService: GrantsService) {}

  registerPolicy(permission: PermissionCode, policy: RelationshipPolicy): void {
    if (this.policies.has(permission)) throw new Error(`Policy for ${permission} is already registered`);
    this.policies.set(permission, policy);
  }

  grants(user: AuthUser): Promise<EffectiveGrants> {
    return this.grantsService.forUser(user.id, user.permissionsVersion);
  }

  /** Бросает FORBIDDEN (403) или NOT_FOUND (404), если ресурс пользователю не виден вовсе. */
  async assert(
    user: AuthUser,
    permission: PermissionCode,
    scope: ResourceScope,
    resource?: unknown,
  ): Promise<AccessResult> {
    const grants = await this.grants(user);
    const decision = decide(grants, permission, scope);
    if (decision.allowed && decision.mode !== 'POLICY') return { viaPlatform: decision.viaPlatform, grants };
    if (decision.allowed) {
      const policy = this.policies.get(permission);
      if (policy && (await policy(user, scope, resource))) return { viaPlatform: false, grants };
    }
    if (!canSee(grants, scope)) throw new DomainError('NOT_FOUND', { resource: scope.kind.toLowerCase() });
    throw new DomainError('FORBIDDEN', { permission });
  }

  async can(
    user: AuthUser,
    permission: PermissionCode,
    scope: ResourceScope,
    resource?: unknown,
  ): Promise<boolean> {
    try {
      await this.assert(user, permission, scope, resource);
      return true;
    } catch (e) {
      if (e instanceof DomainError) return false;
      throw e;
    }
  }

  async isVisible(user: AuthUser, scope: ResourceScope): Promise<boolean> {
    return canSee(await this.grants(user), scope);
  }

  /** Доступные действия над ресурсом: права (без политик) ∩ переданный список кандидатов. */
  async allowedActions(
    user: AuthUser,
    scope: ResourceScope,
    candidates: readonly PermissionCode[],
  ): Promise<PermissionCode[]> {
    const perms = permissionsInScope(await this.grants(user), scope);
    return candidates.filter((c) => perms.has(c));
  }
}
