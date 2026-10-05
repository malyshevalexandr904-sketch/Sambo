// Ковры турнира (Phase 6, §1; DATABASE.md, 3.7): номер, название, активность. Право — mat.manage
// (TOURNAMENT_MANAGER, PERMISSIONS.md, 9). Ковёр не удаляется — деактивируется (isActive: false): у него могут
// быть места в расписании (Restrict), а генерация просто не использует неактивные ковры (domain/generator.ts).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { MatDto, MatInput, MatPatch } from '@sde/contracts';
import { type Mat, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope, ScopeResolverRegistry } from '../../access';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { WriteLeaseService } from '../../venue-sync';

@Injectable()
export class MatsService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly registry: ScopeResolverRegistry,
    private readonly audit: AuditService,
    private readonly leases: WriteLeaseService,
  ) {}

  onModuleInit(): void {
    this.registry.register('mat', (id) => this.scopeOf(id));
  }

  async scopeOf(id: string | undefined): Promise<ResourceScope> {
    const mat = id ? await this.db.mat.findUnique({ where: { id }, select: { competitionId: true } }) : null;
    if (!mat) throw new DomainError('NOT_FOUND', { resource: 'mat' });
    return this.competitions.scopeOf(mat.competitionId);
  }

  private toDto(m: Mat): MatDto {
    return {
      id: m.id,
      competitionId: m.competitionId,
      number: m.number,
      name: m.name,
      isActive: m.isActive,
      version: m.version,
      allowedActions: ['mat.manage'],
    };
  }

  async list(competitionId: string): Promise<MatDto[]> {
    const rows = await this.db.mat.findMany({ where: { competitionId }, orderBy: { number: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async create(user: AuthUser, competitionId: string, input: MatInput): Promise<MatDto> {
    await this.policy.assert(user, 'mat.manage', await this.competitions.scopeOf(competitionId));
    const mat = await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const dup = await tx.mat.findFirst({ where: { competitionId, number: input.number } });
      if (dup) throw new DomainError('MAT_NUMBER_TAKEN', { number: input.number });
      const created = await tx.mat.create({
        data: {
          id: uuidv7(),
          competitionId,
          number: input.number,
          name: input.name ?? null,
          isActive: input.isActive,
        },
      });
      await this.audit.record(tx, {
        action: 'mat.created',
        entityType: 'Mat',
        entityId: created.id,
        competitionId,
        after: { number: created.number, name: created.name, isActive: created.isActive },
      });
      return created;
    });
    return this.toDto(mat);
  }

  async update(
    user: AuthUser,
    competitionId: string,
    matId: string,
    version: number,
    patch: MatPatch,
  ): Promise<MatDto> {
    await this.policy.assert(user, 'mat.manage', await this.competitions.scopeOf(competitionId));
    const mat = await this.db.tx(async (tx) => {
      await this.leases.assertWritable(tx, competitionId);
      const current = await tx.mat.findFirst({ where: { id: matId, competitionId } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'mat' });
      if (current.version !== version) throw versionConflict(current.version);
      if (patch.number !== undefined && patch.number !== current.number) {
        const dup = await tx.mat.findFirst({
          where: { competitionId, number: patch.number, id: { not: matId } },
        });
        if (dup) throw new DomainError('MAT_NUMBER_TAKEN', { number: patch.number });
      }
      const { count } = await tx.mat.updateMany({
        where: { id: matId, version },
        data: { ...patch, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(current.version + 1);
      await this.audit.record(tx, {
        action: 'mat.updated',
        entityType: 'Mat',
        entityId: matId,
        competitionId,
        before: Object.fromEntries(
          Object.keys(patch).map((k) => [k, (current as Record<string, unknown>)[k]]),
        ),
        after: patch,
      });
      return tx.mat.findUniqueOrThrow({ where: { id: matId } });
    });
    return this.toDto(mat);
  }
}
