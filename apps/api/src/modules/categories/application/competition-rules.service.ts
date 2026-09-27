// Требования положения и правила допуска к категориям (API.md, 5.1–5.2). Список заменяется целиком;
// требования меняются только до закрытия регистрации, чтобы заявки проверялись по известным правилам.
import { Injectable } from '@nestjs/common';
import type {
  CategoryRuleDto,
  CategoryRulesPut,
  CompetitionStatus,
  RequirementDto,
  RequirementsPut,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { OutboxService } from '../../outbox';
import { WriteLeaseService } from '../../venue-sync';
import type { CategoryRuleSpec } from '../domain/eligibility';
import { CompetitionCategoriesService } from './competition-categories.service';

const EDITABLE: readonly CompetitionStatus[] = ['DRAFT', 'REGISTRATION_OPEN'];

@Injectable()
export class CompetitionRulesService {
  constructor(
    private readonly db: PrismaService,
    private readonly categories: CompetitionCategoriesService,
    private readonly competitions: CompetitionScopeService,
    private readonly leases: WriteLeaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async requirements(user: AuthUser, competitionId: string): Promise<RequirementDto[]> {
    await this.categories.assertReadable(user, competitionId);
    const rows = await this.db.competitionRequirement.findMany({
      where: { competitionId },
      orderBy: [{ kind: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      kind: r.kind,
      documentTypeCode: r.documentTypeCode,
      consentKind: r.consentKind,
      mandatory: r.mandatory,
      noteMd: r.noteMd,
    }));
  }

  async rules(user: AuthUser, competitionId: string): Promise<CategoryRuleDto[]> {
    await this.categories.assertReadable(user, competitionId);
    const rows = await this.db.categoryRule.findMany({
      where: { competitionId },
      orderBy: [{ kind: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      kind: r.kind,
      params: r.params as Record<string, unknown>,
    }));
  }

  /** Правила для расчёта совместимости (модуль заявок). */
  async ruleSpecs(competitionId: string, tx?: Tx): Promise<CategoryRuleSpec[]> {
    const rows = await (tx ?? this.db).categoryRule.findMany({ where: { competitionId } });
    return rows.map((r) => ({
      kind: r.kind,
      categoryId: r.categoryId,
      params: r.params as Record<string, unknown>,
    }));
  }

  private async lockEditable(tx: Tx, competitionId: string): Promise<void> {
    await this.leases.assertWritable(tx, competitionId);
    const rows = await tx.$queryRaw<{ status: CompetitionStatus }[]>`
      SELECT status FROM competition WHERE id = ${competitionId}::uuid AND deleted_at IS NULL FOR SHARE`;
    if (!rows[0]) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    if (!EDITABLE.includes(rows[0].status))
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['registration_closed'] });
  }

  private async assertCategories(
    tx: Tx,
    competitionId: string,
    ids: (string | null | undefined)[],
    path: string,
  ): Promise<void> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (wanted.length === 0) return;
    const found = await tx.competitionCategory.count({ where: { competitionId, id: { in: wanted } } });
    if (found !== wanted.length)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path, code: 'category_not_found' }] });
  }

  async putRequirements(competitionId: string, input: RequirementsPut): Promise<void> {
    await this.competitions.require(competitionId);
    await this.db.tx(async (tx) => {
      await this.lockEditable(tx, competitionId);
      await this.assertCategories(
        tx,
        competitionId,
        input.requirements.map((r) => r.categoryId),
        'requirements',
      );
      const codes = [
        ...new Set(input.requirements.map((r) => r.documentTypeCode).filter((c): c is string => !!c)),
      ];
      if (
        codes.length > 0 &&
        (await tx.documentType.count({ where: { code: { in: codes } } })) !== codes.length
      )
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'requirements', code: 'document_type_not_found' }],
        });
      const keys = input.requirements.map(
        (r) => `${r.categoryId ?? ''}:${r.kind}:${r.documentTypeCode ?? ''}:${r.consentKind ?? ''}`,
      );
      if (new Set(keys).size !== keys.length)
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'requirements', code: 'duplicate' }] });
      const before = await tx.competitionRequirement.count({ where: { competitionId } });
      await tx.competitionRequirement.deleteMany({ where: { competitionId } });
      if (input.requirements.length > 0)
        await tx.competitionRequirement.createMany({
          data: input.requirements.map((r) => ({
            id: uuidv7(),
            competitionId,
            categoryId: r.categoryId ?? null,
            kind: r.kind,
            documentTypeCode: r.documentTypeCode ?? null,
            consentKind: r.consentKind ?? null,
            mandatory: r.mandatory,
            noteMd: r.noteMd ?? null,
          })),
        });
      await this.audit.record(tx, {
        action: 'competition.requirements_updated',
        entityType: 'Competition',
        entityId: competitionId,
        competitionId,
        before: { count: before },
        after: { count: input.requirements.length, kinds: input.requirements.map((r) => r.kind) },
      });
      await this.outbox.enqueue(tx, {
        type: 'competition.requirements_changed',
        aggregate: { type: 'Competition', id: competitionId },
        competitionId,
        payload: { competitionId },
      });
    });
  }

  async putRules(competitionId: string, input: CategoryRulesPut): Promise<void> {
    await this.competitions.require(competitionId);
    await this.db.tx(async (tx) => {
      await this.lockEditable(tx, competitionId);
      await this.assertCategories(
        tx,
        competitionId,
        input.rules.map((r) => r.categoryId),
        'rules',
      );
      const ranks = input.rules
        .filter((r) => r.kind === 'MIN_RANK' || r.kind === 'MAX_RANK')
        .map((r) => String(r.params.sportRankCode));
      if (
        ranks.length > 0 &&
        (await tx.sportRank.count({ where: { code: { in: [...new Set(ranks)] } } })) !== new Set(ranks).size
      )
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'rules', code: 'sport_rank_not_found' }],
        });
      const regions = input.rules
        .filter((r) => r.kind === 'REGION_ONLY')
        .flatMap((r) => (Array.isArray(r.params.regionIds) ? (r.params.regionIds as string[]) : []));
      if (
        regions.length > 0 &&
        (await tx.region.count({ where: { id: { in: [...new Set(regions)] } } })) !== new Set(regions).size
      )
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'rules', code: 'region_not_found' }] });
      const keys = input.rules.map((r) => `${r.categoryId ?? ''}:${r.kind}`);
      if (new Set(keys).size !== keys.length)
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'rules', code: 'duplicate' }] });
      const before = await tx.categoryRule.count({ where: { competitionId } });
      await tx.categoryRule.deleteMany({ where: { competitionId } });
      if (input.rules.length > 0)
        await tx.categoryRule.createMany({
          data: input.rules.map((r) => ({
            id: uuidv7(),
            competitionId,
            categoryId: r.categoryId ?? null,
            kind: r.kind,
            params: r.params as Prisma.InputJsonValue,
          })),
        });
      await this.audit.record(tx, {
        action: 'competition.category_rules_updated',
        entityType: 'Competition',
        entityId: competitionId,
        competitionId,
        before: { count: before },
        after: {
          count: input.rules.length,
          rules: input.rules.map((r) => ({ kind: r.kind, params: r.params })),
        },
      });
    });
  }
}
