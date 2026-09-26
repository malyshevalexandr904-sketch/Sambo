import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  CategoriesQuery,
  CategoryGenerateRequest,
  CategoryInput,
  CategoryMergeRequest,
  CategoryPatch,
  type CategoryRuleDto,
  CategoryRulesPut,
  CategoryTransitionRequest,
  type CompetitionCategoryDto,
  type DataEnvelope,
  type Page,
  type RequirementDto,
  RequirementsPut,
} from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { IfMatchVersion, ok } from '../../../common/http/http';
import { UuidParam, ValidBody, ValidQuery } from '../../../common/validation/zod.pipe';
import { Authenticated, RequirePermission } from '../../access';
import { WriteAuthority } from '../../venue-sync';
import { CompetitionCategoriesService } from '../application/competition-categories.service';
import { CompetitionRulesService } from '../application/competition-rules.service';

const COMP = { resolver: 'competition', param: 'id' };

/**
 * Категории турнира, требования положения и правила допуска (API.md, 5.1–5.2). Чтение — любому вошедшему для
 * опубликованного турнира, персоналу — для черновика; изменения категорий — операционные команды ([L]).
 */
@Controller('competitions/:id')
export class CompetitionCategoriesController {
  constructor(
    private readonly categories: CompetitionCategoriesService,
    private readonly rules: CompetitionRulesService,
  ) {}

  @Get('categories')
  @Authenticated()
  list(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidQuery(CategoriesQuery) q: CategoriesQuery,
  ): Promise<Page<CompetitionCategoryDto>> {
    return this.categories.list(user, id, q);
  }

  @Post('categories/generate')
  @RequirePermission('competition_category.manage', COMP)
  @WriteAuthority(COMP)
  async generate(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CategoryGenerateRequest) body: CategoryGenerateRequest,
  ): Promise<DataEnvelope<CompetitionCategoryDto[]>> {
    return ok(await this.categories.generate(user, id, body));
  }

  @Post('categories/merge')
  @RequirePermission('category.merge', COMP)
  @WriteAuthority(COMP)
  @HttpCode(200)
  async merge(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CategoryMergeRequest) body: CategoryMergeRequest,
  ): Promise<DataEnvelope<CompetitionCategoryDto>> {
    return ok(await this.categories.merge(user, id, body));
  }

  @Post('categories')
  @RequirePermission('competition_category.manage', COMP)
  @WriteAuthority(COMP)
  async create(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CategoryInput) body: CategoryInput,
  ): Promise<DataEnvelope<CompetitionCategoryDto>> {
    return ok(await this.categories.create(user, id, body));
  }

  @Get('categories/:categoryId')
  @Authenticated()
  async get(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('categoryId') categoryId: string,
  ): Promise<DataEnvelope<CompetitionCategoryDto>> {
    return ok(await this.categories.get(user, id, categoryId));
  }

  @Patch('categories/:categoryId')
  @RequirePermission('competition_category.manage', COMP)
  @WriteAuthority(COMP)
  async update(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('categoryId') categoryId: string,
    @IfMatchVersion() version: number,
    @ValidBody(CategoryPatch) body: CategoryPatch,
  ): Promise<DataEnvelope<CompetitionCategoryDto>> {
    return ok(await this.categories.update(user, id, categoryId, version, body));
  }

  @Delete('categories/:categoryId')
  @RequirePermission('competition_category.manage', COMP)
  @WriteAuthority(COMP)
  @HttpCode(204)
  async remove(@UuidParam('id') id: string, @UuidParam('categoryId') categoryId: string): Promise<void> {
    await this.categories.remove(id, categoryId);
  }

  @Post('categories/:categoryId/transitions')
  @RequirePermission('competition.transition', COMP)
  @WriteAuthority(COMP)
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @UuidParam('categoryId') categoryId: string,
    @IfMatchVersion() version: number,
    @ValidBody(CategoryTransitionRequest) body: CategoryTransitionRequest,
  ): Promise<DataEnvelope<CompetitionCategoryDto>> {
    return ok(await this.categories.transition(user, id, categoryId, version, body));
  }

  @Get('requirements')
  @Authenticated()
  async requirements(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<RequirementDto[]>> {
    return ok(await this.rules.requirements(user, id));
  }

  @Put('requirements')
  @RequirePermission('competition_category.manage', COMP)
  async putRequirements(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(RequirementsPut) body: RequirementsPut,
  ): Promise<DataEnvelope<RequirementDto[]>> {
    await this.rules.putRequirements(id, body);
    return ok(await this.rules.requirements(user, id));
  }

  @Get('category-rules')
  @Authenticated()
  async categoryRules(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<CategoryRuleDto[]>> {
    return ok(await this.rules.rules(user, id));
  }

  @Put('category-rules')
  @RequirePermission('competition_category.manage', COMP)
  async putCategoryRules(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
    @ValidBody(CategoryRulesPut) body: CategoryRulesPut,
  ): Promise<DataEnvelope<CategoryRuleDto[]>> {
    await this.rules.putRules(id, body);
    return ok(await this.rules.rules(user, id));
  }
}
