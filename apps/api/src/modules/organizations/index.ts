export { OrganizationsModule } from './organizations.module';
export { OrganizationScopeService, type OrganizationScope } from './application/organization-scope.service';
export { slugify } from './domain/organization-rules';
export {
  type ApprovedOrganizationInput,
  OrganizationRegistryService,
  SELECTABLE_ORGANIZATION_TYPES,
} from './application/organization-registry.service';
