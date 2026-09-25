// Область турнира для проверки прав (PERMISSIONS.md, 6). Точка расширения до Phase 4: таблицы турнира ещё нет,
// поэтому турнир известен системе через его персонал (CompetitionMembership), а организатор не определён —
// права дают только турнирные роли и платформа. Phase 4 заменяет источник на таблицу `competition`
// (организатор, наследование ORGANIZER → TOURNAMENT_MANAGER).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { type ResourceScope, ScopeResolverRegistry } from '../../access';

export type CompetitionScope = Extract<ResourceScope, { kind: 'COMPETITION' }>;

const UNKNOWN_ORGANIZER = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class CompetitionScopeService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly registry: ScopeResolverRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('competition', (id) => this.scopeOf(id));
  }

  async exists(competitionId: string): Promise<boolean> {
    const staff = await this.db.competitionMembership.findFirst({
      where: { competitionId, status: 'ACTIVE' },
      select: { id: true },
    });
    return staff !== null;
  }

  async scopeOf(competitionId: string | undefined): Promise<CompetitionScope> {
    if (!competitionId || !(await this.exists(competitionId)))
      throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return {
      kind: 'COMPETITION',
      competitionId,
      organizerOrganizationId: UNKNOWN_ORGANIZER,
      organizerAncestorIds: [],
      visibleToAll: false,
    };
  }
}
