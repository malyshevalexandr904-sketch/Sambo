// Область турнира для проверки прав (PERMISSIONS.md, 6): турнир, организатор и его предки (ORGANIZER_INHERIT,
// ORG_DESCENDANT). Опубликованный турнир виден любому вошедшему; черновик — только персоналу и организаторам.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { CompetitionStatus } from '@sde/contracts';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { type ResourceScope, ScopeResolverRegistry } from '../../access';
import { OrganizationScopeService } from '../../organizations';

export type CompetitionScope = Extract<ResourceScope, { kind: 'COMPETITION' }>;

/** Сведения о турнире для соседних модулей (категории, заявки, документы). */
export interface CompetitionBasics {
  id: string;
  slug: string;
  name: string;
  status: CompetitionStatus;
  organizerOrganizationId: string;
  disciplineCode: string;
  timezone: string;
  startDate: string;
  endDate: string;
  registrationStartsAt: Date;
  registrationEndsAt: Date;
  ruleSetVersionId: string | null;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

@Injectable()
export class CompetitionScopeService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly registry: ScopeResolverRegistry,
    private readonly orgScopes: OrganizationScopeService,
  ) {}

  onModuleInit(): void {
    this.registry.register('competition', (id) => this.scopeOf(id));
  }

  async basics(competitionId: string | undefined): Promise<CompetitionBasics | null> {
    if (!competitionId) return null;
    const c = await this.db.competition.findFirst({
      where: { id: competitionId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        organizerOrganizationId: true,
        disciplineCode: true,
        timezone: true,
        startDate: true,
        endDate: true,
        registrationStartsAt: true,
        registrationEndsAt: true,
        ruleSetVersionId: true,
      },
    });
    return c ? { ...c, startDate: dateOnly(c.startDate), endDate: dateOnly(c.endDate) } : null;
  }

  async require(competitionId: string | undefined): Promise<CompetitionBasics> {
    const c = await this.basics(competitionId);
    if (!c) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return c;
  }

  async exists(competitionId: string): Promise<boolean> {
    return (await this.basics(competitionId)) !== null;
  }

  async scopeOf(competitionId: string | undefined): Promise<CompetitionScope> {
    return this.scopeFor(await this.require(competitionId));
  }

  async scopeFor(
    c: Pick<CompetitionBasics, 'id' | 'status' | 'organizerOrganizationId'>,
  ): Promise<CompetitionScope> {
    const organizer = await this.orgScopes.scopeOf(c.organizerOrganizationId);
    return {
      kind: 'COMPETITION',
      competitionId: c.id,
      organizerOrganizationId: c.organizerOrganizationId,
      organizerAncestorIds: organizer.ancestorIds,
      visibleToAll: c.status !== 'DRAFT',
    };
  }
}
