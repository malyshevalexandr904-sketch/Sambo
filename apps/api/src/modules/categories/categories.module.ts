import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CompetitionsModule } from '../competitions';
import { OrganizationsModule } from '../organizations';
import {
  AgeGroupsController,
  CategoryTemplatesController,
  WeightCategoriesController,
} from './api/categories.controller';
import { CompetitionCategoriesController } from './api/competition-categories.controller';
import { AgeGroupsService } from './application/age-groups.service';
import { CategoryExtensions } from './application/category-extensions';
import { CategoryLifecycle } from './application/category-lifecycle';
import { CategoryTemplatesService } from './application/category-templates.service';
import { CategoryBulkService } from './application/category-bulk.service';
import { CompetitionCategoriesService } from './application/competition-categories.service';
import { CompetitionRulesService } from './application/competition-rules.service';
import { OwnerScopeService } from './application/owner-scope.service';

/**
 * Категории: справочники Phase 3 (возрастные группы, веса, шаблоны), доменные функции возраста и совместимости;
 * с Phase 4a — категории турнира, требования положения и правила допуска.
 */
@Module({
  imports: [OrganizationsModule, CompetitionsModule, AuditModule],
  controllers: [
    AgeGroupsController,
    WeightCategoriesController,
    CategoryTemplatesController,
    CompetitionCategoriesController,
  ],
  providers: [
    OwnerScopeService,
    AgeGroupsService,
    CategoryTemplatesService,
    CategoryExtensions,
    CategoryLifecycle,
    CompetitionCategoriesService,
    CategoryBulkService,
    CompetitionRulesService,
  ],
  exports: [CategoryExtensions, CompetitionCategoriesService, CompetitionRulesService],
})
export class CategoriesModule {}
