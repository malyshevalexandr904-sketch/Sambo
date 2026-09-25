import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  type AgeGroupDto,
  AgeGroupInput,
  AgeGroupPatch,
  AgeGroupsQuery,
  CategoryTemplateInput,
  type CategoryTemplateDto,
  CategoryTemplatePatch,
  type DataEnvelope,
  WeightCategoriesQuery,
  type WeightCategoryDto,
  WeightCategoryInput,
  WeightCategoryPatch,
} from '@sde/contracts';
import type { z } from 'zod';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { AgeGroupsService } from '../application/age-groups.service';
import {
  CategoryTemplatesListQuery,
  CategoryTemplatesService,
} from '../application/category-templates.service';

const AGE_GROUP = { resolver: 'ageGroup', param: 'id' };
const WEIGHT = { resolver: 'weightCategory', param: 'id' };
const TEMPLATE = { resolver: 'categoryTemplate', param: 'id' };

/**
 * Возрастные группы, весовые категории, шаблоны (API.md, 4.5). Чтение — любой вошедший; запись —
 * `category.manage` в области владельца (платформа или организация). При создании владелец — из тела.
 */
@Controller('age-groups')
export class AgeGroupsController {
  constructor(private readonly groups: AgeGroupsService) {}

  @Get()
  @Authenticated()
  async list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(AgeGroupsQuery) q: AgeGroupsQuery,
  ): Promise<DataEnvelope<AgeGroupDto[]>> {
    return ok(await this.groups.list(user, q));
  }

  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(AgeGroupInput) body: AgeGroupInput,
  ): Promise<DataEnvelope<AgeGroupDto>> {
    return ok(await this.groups.create(user, body));
  }

  @Get(':id')
  @Authenticated()
  async get(@CurrentUser() user: AuthUser, @UuidParam('id') id: string): Promise<DataEnvelope<AgeGroupDto>> {
    return ok(await this.groups.get(user, id));
  }

  @Patch(':id')
  @RequirePermission('category.manage', AGE_GROUP)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(AgeGroupPatch) body: AgeGroupPatch,
  ): Promise<DataEnvelope<AgeGroupDto>> {
    return ok(await this.groups.update(user, id, body));
  }

  @Delete(':id')
  @RequirePermission('category.manage', AGE_GROUP)
  @HttpCode(204)
  async remove(@UuidParam('id') id: string): Promise<void> {
    await this.groups.remove(id);
  }
}

@Controller('weight-categories')
export class WeightCategoriesController {
  constructor(private readonly groups: AgeGroupsService) {}

  @Get()
  @Authenticated()
  async list(
    @ValidQuery(WeightCategoriesQuery) q: z.infer<typeof WeightCategoriesQuery>,
  ): Promise<DataEnvelope<WeightCategoryDto[]>> {
    return ok(await this.groups.weights(q.ageGroupId));
  }

  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(WeightCategoryInput) body: WeightCategoryInput,
  ): Promise<DataEnvelope<WeightCategoryDto>> {
    return ok(await this.groups.createWeight(user, body));
  }

  @Patch(':id')
  @RequirePermission('category.manage', WEIGHT)
  async update(
    @UuidParam('id') id: string,
    @ValidBody(WeightCategoryPatch) body: WeightCategoryPatch,
  ): Promise<DataEnvelope<WeightCategoryDto>> {
    return ok(await this.groups.updateWeight(id, body));
  }

  @Delete(':id')
  @RequirePermission('category.manage', WEIGHT)
  @HttpCode(204)
  async remove(@UuidParam('id') id: string): Promise<void> {
    await this.groups.removeWeight(id);
  }
}

@Controller('category-templates')
export class CategoryTemplatesController {
  constructor(private readonly templates: CategoryTemplatesService) {}

  @Get()
  @Authenticated()
  async list(
    @CurrentUser() user: AuthUser,
    @ValidQuery(CategoryTemplatesListQuery) q: z.infer<typeof CategoryTemplatesListQuery>,
  ): Promise<DataEnvelope<CategoryTemplateDto[]>> {
    return ok(await this.templates.list(user, q));
  }

  @Post()
  @Authenticated()
  async create(
    @CurrentUser() user: AuthUser,
    @ValidBody(CategoryTemplateInput) body: CategoryTemplateInput,
  ): Promise<DataEnvelope<CategoryTemplateDto>> {
    return ok(await this.templates.create(user, body));
  }

  @Get(':id')
  @Authenticated()
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CategoryTemplateDto>> {
    return ok(await this.templates.get(user, id));
  }

  @Patch(':id')
  @RequirePermission('category.manage', TEMPLATE)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CategoryTemplatePatch) body: CategoryTemplatePatch,
  ): Promise<DataEnvelope<CategoryTemplateDto>> {
    return ok(await this.templates.update(user, id, body));
  }

  @Delete(':id')
  @RequirePermission('category.manage', TEMPLATE)
  @HttpCode(204)
  async remove(@UuidParam('id') id: string): Promise<void> {
    await this.templates.remove(id);
  }
}
