// PolicyService (ARCHITECTURE.md, 8): решение о доступе, политики отношений, allowedActions.
import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import {
  canSee,
  decide,
  type EffectiveGrants,
  holdsAnywhere,
  NOWHERE_SCOPE,
  organizationReach,
  type OrganizationReach,
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
  /** Область, в которой право подтвердилось. */
  scope: ResourceScope;
}

@Injectable()
export class PolicyService {
  private readonly policies = new Map<PermissionCode, RelationshipPolicy>();
  /** Эффективные права собираются один раз на запрос: AuthUser — объект запроса. */
  private readonly perRequest = new WeakMap<AuthUser, Promise<EffectiveGrants>>();

  constructor(private readonly grantsService: GrantsService) {}

  registerPolicy(permission: PermissionCode, policy: RelationshipPolicy): void {
    if (this.policies.has(permission)) throw new Error(`Policy for ${permission} is already registered`);
    this.policies.set(permission, policy);
  }

  grants(user: AuthUser): Promise<EffectiveGrants> {
    let pending = this.perRequest.get(user);
    if (!pending) {
      pending = this.grantsService.forUser(user.id, user.permissionsVersion);
      this.perRequest.set(user, pending);
      pending.catch(() => this.perRequest.delete(user));
    }
    return pending;
  }

  /** Бросает FORBIDDEN (403) или NOT_FOUND (404), если ресурс пользователю не виден вовсе. */
  assert(
    user: AuthUser,
    permission: PermissionCode,
    scope: ResourceScope,
    resource?: unknown,
  ): Promise<AccessResult> {
    return this.assertAny(user, permission, [scope], resource);
  }

  /**
   * Ресурс с несколькими областями (спортсмен в клубе и в спортшколе): право достаточно иметь в любой.
   * Нет ни одной области, где ресурс виден, — 404; виден, но права нет — 403.
   */
  async assertAny(
    user: AuthUser,
    permission: PermissionCode,
    scopes: readonly ResourceScope[],
    resource?: unknown,
  ): Promise<AccessResult> {
    const grants = await this.grants(user);
    const list = scopes.length > 0 ? scopes : [NOWHERE_SCOPE];
    for (const scope of list) {
      const decision = decide(grants, permission, scope);
      if (!decision.allowed) continue;
      if (decision.mode !== 'POLICY') return { viaPlatform: decision.viaPlatform, grants, scope };
      const policy = this.policies.get(permission);
      if (policy && (await policy(user, scope, resource))) return { viaPlatform: false, grants, scope };
    }
    if (!list.some((s) => canSee(grants, s))) {
      throw new DomainError('NOT_FOUND', { resource: list[0]?.kind.toLowerCase() ?? 'resource' });
    }
    throw new DomainError('FORBIDDEN', { permission });
  }

  async can(
    user: AuthUser,
    permission: PermissionCode,
    scope: ResourceScope,
    resource?: unknown,
  ): Promise<boolean> {
    return this.canAny(user, permission, [scope], resource);
  }

  async canAny(
    user: AuthUser,
    permission: PermissionCode,
    scopes: readonly ResourceScope[],
    resource?: unknown,
  ): Promise<boolean> {
    try {
      await this.assertAny(user, permission, scopes, resource);
      return true;
    } catch (e) {
      if (e instanceof DomainError) return false;
      throw e;
    }
  }

  async isVisible(user: AuthUser, scope: ResourceScope): Promise<boolean> {
    return canSee(await this.grants(user), scope);
  }

  async isVisibleAny(user: AuthUser, scopes: readonly ResourceScope[]): Promise<boolean> {
    const grants = await this.grants(user);
    return scopes.some((s) => canSee(grants, s));
  }

  /** Где право действует в организациях: для фильтров списков в SQL (PERMISSIONS.md, 6). */
  async reach(user: AuthUser, permission: PermissionCode): Promise<OrganizationReach> {
    return organizationReach(await this.grants(user), permission);
  }

  /** Право есть хоть в одной области (например, `referee.manage` у администратора любой федерации). */
  async holdsAnywhere(user: AuthUser, permission: PermissionCode): Promise<boolean> {
    return holdsAnywhere(await this.grants(user), permission);
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

  /** Доступные действия с учётом политик отношений и нескольких областей ресурса. */
  async allowedActionsAny(
    user: AuthUser,
    scopes: readonly ResourceScope[],
    candidates: readonly PermissionCode[],
    resource?: unknown,
  ): Promise<PermissionCode[]> {
    const result: PermissionCode[] = [];
    for (const c of candidates) if (await this.canAny(user, c, scopes, resource)) result.push(c);
    return result;
  }
}
