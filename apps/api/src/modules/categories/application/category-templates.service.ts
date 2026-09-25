// Шаблоны наборов категорий (API.md, 4.5): возрастная группа × пол × весовые категории. С Phase 4 турнир
// генерирует из шаблона свои категории со снимком границ.
import { Injectable } from '@nestjs/common';
import type {
  CategoryTemplateDto,
  CategoryTemplateInput,
  CategoryTemplatePatch,
  Gender,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import { z } from 'zod';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { OwnerScopeService } from './owner-scope.service';

export const CategoryTemplatesListQuery = z.object({
  disciplineCode: z.string().max(40).optional(),
  owner: z.union([z.literal('platform'), z.uuid()]).optional(),
});

const INCLUDE = {
  ownerOrganization: { select: { id: true, name: true, shortName: true } },
  items: { include: { ageGroup: { select: { code: true, ageFrom: true } }, weightCategory: true } },
} satisfies Prisma.CategoryTemplateInclude;
type Row = Prisma.CategoryTemplateGetPayload<{ include: typeof INCLUDE }>;

type Items = CategoryTemplateInput['items'];

@Injectable()
export class CategoryTemplatesService {
  constructor(
    private readonly db: PrismaService,
    private readonly owners: OwnerScopeService,
    private readonly audit: AuditService,
  ) {}

  private async toDto(user: AuthUser, t: Row): Promise<CategoryTemplateDto> {
    const groups = new Map<string, CategoryTemplateDto['items'][number] & { ageFrom: number }>();
    for (const i of t.items) {
      const key = `${i.ageGroupId}:${i.gender}`;
      const g = groups.get(key) ?? {
        ageGroupId: i.ageGroupId,
        ageGroupCode: i.ageGroup.code,
        gender: i.gender,
        weightCategoryIds: [],
        ageFrom: i.ageGroup.ageFrom,
      };
      g.weightCategoryIds.push(i.weightCategoryId);
      groups.set(key, g);
    }
    const order = (x: { ageFrom: number; gender: Gender }) => x.ageFrom * 10 + (x.gender === 'MALE' ? 0 : 1);
    return {
      id: t.id,
      name: t.name,
      disciplineCode: t.disciplineCode,
      owner: t.ownerOrganization,
      items: [...groups.values()].sort((a, b) => order(a) - order(b)).map(({ ageFrom: _a, ...rest }) => rest),
      categoryCount: t.items.length,
      allowedActions: (await this.owners.canManage(user, t.ownerOrganizationId)) ? ['category.manage'] : [],
    };
  }

  async list(user: AuthUser, q: z.infer<typeof CategoryTemplatesListQuery>): Promise<CategoryTemplateDto[]> {
    const rows = await this.db.categoryTemplate.findMany({
      where: {
        deletedAt: null,
        disciplineCode: q.disciplineCode,
        ...(q.owner === undefined ? {} : { ownerOrganizationId: q.owner === 'platform' ? null : q.owner }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: INCLUDE,
      take: 200,
    });
    return Promise.all(rows.map((r) => this.toDto(user, r)));
  }

  async get(user: AuthUser, id: string): Promise<CategoryTemplateDto> {
    const t = await this.db.categoryTemplate.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!t) throw new DomainError('NOT_FOUND', { resource: 'category_template' });
    return this.toDto(user, t);
  }

  /**
   * Состав шаблона: группы той же дисциплины — платформы, владельца шаблона или его вышестоящих организаций;
   * весовые категории — этой группы и этого пола; без повторов.
   */
  private async validateItems(
    tx: Tx,
    items: Items,
    disciplineCode: string,
    ownerOrganizationId: string | null,
  ): Promise<{ ageGroupId: string; gender: Gender; weightCategoryId: string }[]> {
    const lineage = await this.owners.ownerLineage(ownerOrganizationId);
    const rows: { ageGroupId: string; gender: Gender; weightCategoryId: string }[] = [];
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      const group = await tx.ageGroup.findFirst({ where: { id: item.ageGroupId, deletedAt: null } });
      const groupOk =
        group &&
        group.disciplineCode === disciplineCode &&
        (group.ownerOrganizationId === null || lineage.includes(group.ownerOrganizationId));
      if (!groupOk)
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: `items.${index}.ageGroupId`, code: 'not_found' }],
        });
      const weights = await tx.weightCategory.findMany({
        where: {
          id: { in: item.weightCategoryIds },
          ageGroupId: item.ageGroupId,
          gender: item.gender,
          deletedAt: null,
        },
      });
      if (
        weights.length !== new Set(item.weightCategoryIds).size ||
        weights.length !== item.weightCategoryIds.length
      )
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: `items.${index}.weightCategoryIds`, code: 'invalid_weight_category' }],
        });
      for (const w of weights) {
        if (seen.has(w.id))
          throw new DomainError('VALIDATION_FAILED', {
            fields: [{ path: `items.${index}.weightCategoryIds`, code: 'duplicate' }],
          });
        seen.add(w.id);
        rows.push({ ageGroupId: item.ageGroupId, gender: item.gender, weightCategoryId: w.id });
      }
    }
    return rows;
  }

  async create(user: AuthUser, input: CategoryTemplateInput): Promise<CategoryTemplateDto> {
    await this.owners.assertManage(user, input.ownerOrganizationId);
    const id = await this.db.tx(async (tx) => {
      if (!(await tx.discipline.findUnique({ where: { code: input.disciplineCode } })))
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'disciplineCode', code: 'invalid_code' }],
        });
      const owner = input.ownerOrganizationId ?? null;
      const items = await this.validateItems(tx, input.items, input.disciplineCode, owner);
      const t = await tx.categoryTemplate.create({
        data: {
          id: uuidv7(),
          name: input.name,
          disciplineCode: input.disciplineCode,
          ownerOrganizationId: owner,
          createdById: user.id,
          items: { create: items.map((i) => ({ id: uuidv7(), ...i })) },
        },
      });
      await this.audit.record(tx, {
        action: 'category_template.created',
        entityType: 'CategoryTemplate',
        entityId: t.id,
        organizationId: owner,
        after: { name: t.name, disciplineCode: t.disciplineCode, categories: items.length },
      });
      return t.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, patch: CategoryTemplatePatch): Promise<CategoryTemplateDto> {
    await this.db.tx(async (tx) => {
      const t = await tx.categoryTemplate.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { items: true },
      });
      if (patch.name) await tx.categoryTemplate.update({ where: { id }, data: { name: patch.name } });
      let categories = t.items.length;
      if (patch.items) {
        const items = await this.validateItems(tx, patch.items, t.disciplineCode, t.ownerOrganizationId);
        await tx.categoryTemplateItem.deleteMany({ where: { templateId: id } });
        await tx.categoryTemplateItem.createMany({
          data: items.map((i) => ({ id: uuidv7(), templateId: id, ...i })),
        });
        await tx.categoryTemplate.update({ where: { id }, data: { updatedAt: new Date() } });
        categories = items.length;
      }
      await this.audit.record(tx, {
        action: 'category_template.updated',
        entityType: 'CategoryTemplate',
        entityId: id,
        organizationId: t.ownerOrganizationId,
        before: { name: t.name, categories: t.items.length },
        after: { name: patch.name ?? t.name, categories },
      });
    });
    return this.get(user, id);
  }

  async remove(id: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const t = await tx.categoryTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'category_template.deleted',
        entityType: 'CategoryTemplate',
        entityId: id,
        organizationId: t.ownerOrganizationId,
        before: { name: t.name },
      });
    });
  }
}
