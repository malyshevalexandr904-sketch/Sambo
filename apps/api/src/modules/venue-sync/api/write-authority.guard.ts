// Guard права записи (ARCHITECTURE.md, 5): после PermissionGuard, до разбора тела запроса. Маршруты с пометкой
// [L] в API.md объявляют @WriteAuthority — облако отвечает 409 WRITE_AUTHORITY_ELSEWHERE, пока право у узла.
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AccessAwareRequest, asResolution, type ScopeRef, ScopeResolverRegistry } from '../../access';
import { WriteLeaseService } from '../application/write-lease.service';

export const WRITE_AUTHORITY = 'sde:write-authority';

/** Операционная команда турнира. `scope` — как у @RequirePermission: ресурс, по которому находится турнир. */
export const WriteAuthority = (scope: ScopeRef): MethodDecorator => SetMetadata(WRITE_AUTHORITY, scope);

@Injectable()
export class WriteAuthorityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scopes: ScopeResolverRegistry,
    private readonly leases: WriteLeaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ref = this.reflector.get<ScopeRef | undefined>(WRITE_AUTHORITY, context.getHandler());
    if (!ref) return true;
    const req = context.switchToHttp().getRequest<AccessAwareRequest>();
    let competitionId = req.accessScope?.kind === 'COMPETITION' ? req.accessScope.competitionId : undefined;
    if (!competitionId) {
      const param = ref.param ? req.params[ref.param] : undefined;
      const resolution = asResolution(
        await this.scopes.get(ref.resolver)(typeof param === 'string' ? param : undefined, req),
      );
      const scope = resolution.scopes.find((s) => s.kind === 'COMPETITION');
      competitionId = scope?.kind === 'COMPETITION' ? scope.competitionId : undefined;
    }
    if (competitionId) await this.leases.assertHeld(competitionId);
    return true;
  }
}
