// Возрастные группы и весовые категории (API.md, 4.5; DATABASE.md, 3.4). Удаление — мягкое: турниры хранят
// снимок границ категории, поэтому удалённая группа им не мешает; используемую в шаблоне — не удалить.
import { Injectable } from '@nestjs/common';
import type {
  AgeGroupDto,
  AgeGroupInput,
  AgeGroupPatch,
  AgeGroupsQuery,
  WeightCategoryDto,
  WeightCategoryInput,
  WeightCategoryPatch,
} from '@sde/contracts';
import { type Prisma, type WeightCategory, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { OwnerScopeService } from './owner-scope.service';

const INCLUDE = {
  ownerOrganization: { select: { id: true, name: true, shortName: true } },
  weightCategories: {
    where: { deletedAt: null },
    orderBy: [{ gender: 'asc' }, { sortOrder: 'asc' }, { kind: 'desc' }, { limitGrams: 'asc' }],
  },
} satisfies Prisma.AgeGroupInclude;
type Row = Prisma.AgeGroupGetPayload<{ include: typeof INCLUDE }>;

export const weightDto = (w: WeightCategory): WeightCategoryDto => ({
  id: w.id,
  ageGroupId: w.ageGroupId,
  gender: w.gender,
  kind: w.kind,
  limitGrams: w.limitGrams,
  sortOrder: w.sortOrder,
});

const ownerWhere = (owner: string | undefined): Prisma.AgeGroupWhereInput =>
  owner === undefined
    ? {}
    : owner === 'platform'
      ? { ownerOrganizationId: null }
      : { ownerOrganizationId: owner };

@Injectable()
export class AgeGroupsService {
  constructor(
    private readonly db: PrismaService,
    private readonly owners: OwnerScopeService,
    private readonly audit: AuditService,
  ) {}

  private async toDto(user: AuthUser, g: Row): Promise<AgeGroupDto> {
    return {
      id: g.id,
      disciplineCode: g.disciplineCode,
      owner: g.ownerOrganization,
      code: g.code,
      name: { ru: g.nameRu, en: g.nameEn },
      policy: g.policy,
      ageFrom: g.ageFrom,
      ageTo: g.ageTo,
      weightCategories: g.weightCategories.map(weightDto),
      allowedActions: (await this.owners.canManage(user, g.ownerOrganizationId)) ? ['category.manage'] : [],
    };
  }

  async list(user: AuthUser, q: AgeGroupsQuery): Promise<AgeGroupDto[]> {
    const rows = await this.db.ageGroup.findMany({
      where: { deletedAt: null, disciplineCode: q.disciplineCode, ...ownerWhere(q.owner) },
      orderBy: [{ ageFrom: 'asc' }, { ageTo: 'asc' }, { code: 'asc' }],
      include: INCLUDE,
      take: 500,
    });
    return Promise.all(rows.map((r) => this.toDto(user, r)));
  }

  async get(user: AuthUser, id: string): Promise<AgeGroupDto> {
    const g = await this.db.ageGroup.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!g) throw new DomainError('NOT_FOUND', { resource: 'age_group' });
    return this.toDto(user, g);
  }

  async create(user: AuthUser, input: AgeGroupInput): Promise<AgeGroupDto> {
    await this.owners.assertManage(user, input.ownerOrganizationId);
    const id = await this.db.tx(async (tx) => {
      if (!(await tx.discipline.findUnique({ where: { code: input.disciplineCode } })))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'disciplineCode', code: 'invalid_code' }],
        });
      const clash = await tx.ageGroup.findFirst({
        where: {
          ownerOrganizationId: input.ownerOrganizationId ?? null,
          disciplineCode: input.disciplineCode,
          code: input.code,
          deletedAt: null,
        },
      });
      if (clash) throw new DomainError('ALREADY_EXISTS', { resource: 'age_group' });
      const g = await tx.ageGroup.create({
        data: {
          id: uuidv7(),
          disciplineCode: input.disciplineCode,
          ownerOrganizationId: input.ownerOrganizationId ?? null,
          code: input.code,
          nameRu: input.name.ru,
          nameEn: input.name.en,
          policy: input.policy,
          ageFrom: input.ageFrom,
          ageTo: input.ageTo,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'age_group.created',
        entityType: 'AgeGroup',
        entityId: g.id,
        organizationId: g.ownerOrganizationId,
        after: { code: g.code, policy: g.policy, ageFrom: g.ageFrom, ageTo: g.ageTo },
      });
      return g.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, patch: AgeGroupPatch): Promise<AgeGroupDto> {
    await this.db.tx(async (tx) => {
      const g = await tx.ageGroup.findFirstOrThrow({ where: { id, deletedAt: null } });
      const ageFrom = patch.ageFrom ?? g.ageFrom;
      const ageTo = patch.ageTo ?? g.ageTo;
      if (ageFrom > ageTo)
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'ageTo', code: 'age_range_invalid' }],
        });
      await tx.ageGroup.update({
        where: { id },
        data: { nameRu: patch.name?.ru, nameEn: patch.name?.en, policy: patch.policy, ageFrom, ageTo },
      });
      await this.audit.record(tx, {
        action: 'age_group.updated',
        entityType: 'AgeGroup',
        entityId: id,
        organizationId: g.ownerOrganizationId,
        before: { nameRu: g.nameRu, nameEn: g.nameEn, policy: g.policy, ageFrom: g.ageFrom, ageTo: g.ageTo },
        after: {
          nameRu: patch.name?.ru ?? g.nameRu,
          nameEn: patch.name?.en ?? g.nameEn,
          policy: patch.policy ?? g.policy,
          ageFrom,
          ageTo,
        },
      });
    });
    return this.get(user, id);
  }

  async remove(id: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const used = await tx.categoryTemplateItem.count({
        where: { ageGroupId: id, template: { deletedAt: null } },
      });
      if (used > 0)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['used_in_templates'] });
      const g = await tx.ageGroup.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.weightCategory.updateMany({
        where: { ageGroupId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'age_group.deleted',
        entityType: 'AgeGroup',
        entityId: id,
        organizationId: g.ownerOrganizationId,
        before: { code: g.code },
      });
    });
  }

  // ---- Весовые категории ----

  async weights(ageGroupId: string | undefined): Promise<WeightCategoryDto[]> {
    const rows = await this.db.weightCategory.findMany({
      where: { deletedAt: null, ageGroupId, ageGroup: { deletedAt: null } },
      orderBy: [{ ageGroupId: 'asc' }, { gender: 'asc' }, { sortOrder: 'asc' }, { limitGrams: 'asc' }],
      take: 1000,
    });
    return rows.map(weightDto);
  }

  private async assertUnique(
    tx: Prisma.TransactionClient,
    w: {
      ageGroupId: string;
      gender: WeightCategory['gender'];
      kind: WeightCategory['kind'];
      limitGrams: number;
    },
    excludeId?: string,
  ): Promise<void> {
    const clash = await tx.weightCategory.findFirst({
      where: { ...w, deletedAt: null, id: excludeId ? { not: excludeId } : undefined },
    });
    if (clash) throw new DomainError('ALREADY_EXISTS', { resource: 'weight_category' });
  }

  async createWeight(user: AuthUser, input: WeightCategoryInput): Promise<WeightCategoryDto> {
    const group = await this.db.ageGroup.findFirst({ where: { id: input.ageGroupId, deletedAt: null } });
    if (!group)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'ageGroupId', code: 'not_found' }] });
    await this.owners.assertManage(user, group.ownerOrganizationId);
    return this.db.tx(async (tx) => {
      await this.assertUnique(tx, input);
      const w = await tx.weightCategory.create({ data: { id: uuidv7(), ...input } });
      await this.audit.record(tx, {
        action: 'weight_category.created',
        entityType: 'WeightCategory',
        entityId: w.id,
        organizationId: group.ownerOrganizationId,
        after: { ageGroupId: w.ageGroupId, gender: w.gender, kind: w.kind, limitGrams: w.limitGrams },
      });
      return weightDto(w);
    });
  }

  async updateWeight(id: string, patch: WeightCategoryPatch): Promise<WeightCategoryDto> {
    return this.db.tx(async (tx) => {
      const w = await tx.weightCategory.findFirstOrThrow({ where: { id, deletedAt: null } });
      const next = {
        ageGroupId: w.ageGroupId,
        gender: w.gender,
        kind: patch.kind ?? w.kind,
        limitGrams: patch.limitGrams ?? w.limitGrams,
      };
      await this.assertUnique(tx, next, id);
      const updated = await tx.weightCategory.update({
        where: { id },
        data: { kind: patch.kind, limitGrams: patch.limitGrams, sortOrder: patch.sortOrder },
      });
      await this.audit.record(tx, {
        action: 'weight_category.updated',
        entityType: 'WeightCategory',
        entityId: id,
        before: { kind: w.kind, limitGrams: w.limitGrams, sortOrder: w.sortOrder },
        after: { kind: updated.kind, limitGrams: updated.limitGrams, sortOrder: updated.sortOrder },
      });
      return weightDto(updated);
    });
  }

  async removeWeight(id: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const used = await tx.categoryTemplateItem.count({
        where: { weightCategoryId: id, template: { deletedAt: null } },
      });
      if (used > 0)
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['used_in_templates'] });
      const w = await tx.weightCategory.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'weight_category.deleted',
        entityType: 'WeightCategory',
        entityId: id,
        before: { ageGroupId: w.ageGroupId, gender: w.gender, kind: w.kind, limitGrams: w.limitGrams },
      });
    });
  }
}
