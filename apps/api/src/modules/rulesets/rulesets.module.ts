import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations';
import { RuleSetsController } from './api/rulesets.controller';
import { RuleSetsService } from './application/rulesets.service';

@Module({ imports: [OrganizationsModule], controllers: [RuleSetsController], providers: [RuleSetsService] })
export class RuleSetsModule {}
