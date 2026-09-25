import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations';
import {
  AgeGroupsController,
  CategoryTemplatesController,
  WeightCategoriesController,
} from './api/categories.controller';
import { AgeGroupsService } from './application/age-groups.service';
import { CategoryTemplatesService } from './application/category-templates.service';
import { OwnerScopeService } from './application/owner-scope.service';

/** Категории: справочники Phase 3 и доменные функции возраста и совместимости (для Phase 4). */
@Module({
  imports: [OrganizationsModule],
  controllers: [AgeGroupsController, WeightCategoriesController, CategoryTemplatesController],
  providers: [OwnerScopeService, AgeGroupsService, CategoryTemplatesService],
})
export class CategoriesModule {}
